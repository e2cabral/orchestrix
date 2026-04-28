import {IdempotencyRecord, IdempotencyStore} from "../types";
import {IdempotencyRecordNotFoundError} from "../errors";

/**
 * Creates an in-memory implementation of the idempotency store.
 * @returns An instance of IdempotencyStore.
 */
export function createIdempotencyStore(): IdempotencyStore {
  const records: Map<string, IdempotencyRecord> = new Map();

  /**
   * Checks if a record has expired.
   */
  function isExpired(record: IdempotencyRecord): boolean {
    return record.expiresAt !== undefined && Date.now() > record.expiresAt;
  }

  /**
   * Removes a record if it is expired.
   */
  function removeExpired(key: string): void {
    const record = records.get(key);
    if (record && isExpired(record)) {
      records.delete(key);
    }
  }

  return {
    /**
     * Removes all expired records from the store.
     */
    async cleanup() {
      for (const [key, record] of records.entries()) {
        if (isExpired(record)) {
          records.delete(key);
        }
      }
    },

    /**
     * Gets a record by key, removing it if it is expired.
     */
    async get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null> {
      removeExpired(key);

      const record = records.get(key);

      return record ? (record as IdempotencyRecord<T>) : null;
    },

    /**
     * Attempts to start an idempotent operation.
     */
    async start(key: string, options?: { ttlMs?: number }): Promise<{ acquired: boolean; record: IdempotencyRecord }> {
      // Remove expired records synchronously to avoid race conditions
      for (const [k, r] of records.entries()) {
        if (isExpired(r)) {
          records.delete(k);
        }
      }

      const existing = records.get(key);
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
      };

      records.set(key, record);

      return { acquired: true, record };
    },

    /**
     * Marks an operation as completed and stores the result.
     */
    async complete<T = unknown>(key: string, result: T): Promise<void> {
      const record = records.get(key);

      if (!record) {
        throw new IdempotencyRecordNotFoundError(key);
      }

      records.set(key, {
        ...record,
        status: "completed",
        updatedAt: Date.now(),
        data: result
      });
    },

    /**
     * Marks an operation as failed and stores the error.
     */
    async fail(key: string, error: unknown): Promise<void> {
      const record = records.get(key);

      if (!record) {
        throw new IdempotencyRecordNotFoundError(key);
      }

      records.set(key, {
        ...record,
        status: "failed",
        updatedAt: Date.now(),
        error
      });
    },

    /**
     * Removes an idempotency record.
     */
    async delete(key: string): Promise<void> {
      records.delete(key);
    }
  }
}