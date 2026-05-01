import {IdempotencyRecord, IdempotencyStore} from "../types";
import {RedisClientType} from "redis";
import {IdempotencyRecordNotFoundError} from "../errors";

export function redisIdempotencyStore(redis: RedisClientType): IdempotencyStore {
  return {
    async cleanup() {
      // Redis will automatically handle expired keys, so no manual cleanup is needed.
    },
    async get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null> {
      const data = await redis.get(key)
      return data ? JSON.parse(data) as IdempotencyRecord<T> : null;
    },
    async start(key: string, options?: { ttlMs?: number }): Promise<{ acquired: boolean; record: IdempotencyRecord }> {
      const data = await redis.get(key)
      const existing =  data ? JSON.parse(data) as IdempotencyRecord : null;

      if (existing && existing.status === 'running') {
        return { acquired: false, record: existing };
      }

      const now = Date.now();

      const record: IdempotencyRecord = {
        key,
        status: 'running',
        createdAt: now,
        updatedAt: now,
        expiresAt: options?.ttlMs ? now + options.ttlMs : undefined
      }

      const result = await redis.set(key, JSON.stringify(record), { PX: options?.ttlMs, NX: true })

      if (result === null) {
        // Someone else set it while we were preparing our record
        const updatedData = await redis.get(key);
        return { acquired: false, record: updatedData ? JSON.parse(updatedData) as IdempotencyRecord : record };
      }

      return { acquired: true, record };
    },
    async complete<T = unknown>(key: string, result: T): Promise<void> {
      const record = await this.get(key);

      if (!record) {
        throw new IdempotencyRecordNotFoundError(key);
      }

      if (record.expiresAt && record.expiresAt < Date.now()) {
        await redis.del(key);
        return;
      }

      const PX = await redis.pTTL(key);

      await redis.set(
        key,
        JSON.stringify({
          ...record,
          status: 'completed',
          data: result,
          updatedAt: Date.now()
        }),
        { PX }
      )
    },
    async fail(key: string, error: unknown): Promise<void> {
      const record = await this.get(key);

      if (!record) {
        throw new IdempotencyRecordNotFoundError(key);
      }

      const err = error instanceof Error ? error : new Error(String(error));

      const PX = await redis.pTTL(key);

      await redis.set(
        key,
        JSON.stringify({
          ...record,
          status: 'failed',
          error: { message: err?.message ?? 'Unknown error', stack: err?.stack },
          updatedAt: Date.now()
        }),
        { PX }
      )
    },
    async delete(key: string): Promise<void> {
      await redis.del(key);
    },
  }
}
