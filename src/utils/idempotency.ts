import {IdempotencyRecord, IdempotencyStore} from "../types";
import {IdempotencyRecordNotFoundError} from "../errors";

/**
 * Cria uma implementação em memória do armazenamento de idempotência.
 * @returns Uma instância de IdempotencyStore.
 */
export function createIdempotencyStore(): IdempotencyStore {
  const records: Map<string, IdempotencyRecord> = new Map();

  /**
   * Verifica se um registro expirou.
   */
  function isExpired(record: IdempotencyRecord): boolean {
    return record.expiresAt !== undefined && Date.now() > record.expiresAt;
  }

  /**
   * Remove um registro se ele estiver expirado.
   */
  function removeExpired(key: string): void {
    const record = records.get(key);
    if (record && isExpired(record)) {
      records.delete(key);
    }
  }

  return {
    /**
     * Remove todos os registros expirados do armazenamento.
     */
    async cleanup() {
      for (const [key, record] of records.entries()) {
        if (isExpired(record)) {
          records.delete(key);
        }
      }
    },

    /**
     * Obtém um registro pela chave, removendo-o se estiver expirado.
     */
    async get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null> {
      removeExpired(key);

      const record = records.get(key);

      return record ? (record as IdempotencyRecord<T>) : null;
    },

    /**
     * Tenta iniciar uma operação idempotente.
     */
    async start(key: string, options?: { ttlMs?: number }): Promise<{ acquired: boolean; record: IdempotencyRecord }> {
      // Remove registros expirados de forma síncrona para evitar race conditions
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
     * Marca uma operação como concluída e armazena o resultado.
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
     * Marca uma operação como falha e armazena o erro.
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
     * Remove um registro de idempotência.
     */
    async delete(key: string): Promise<void> {
      records.delete(key);
    }
  }
}