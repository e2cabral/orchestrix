import { describe, expect, it, vi } from "vitest";
import { create, createIdempotencyStore } from "../src";
import { IdempotencyRecordNotFoundError } from "../src/errors";

describe("Idempotência", () => {
  it("não executa o mesmo fluxo duas vezes com a mesma chave", async () => {
    const store = createIdempotencyStore();
    const calls: string[] = [];
    
    const flow = create("idempotent-test", { idempotency: store })
      .step("one", () => {
        calls.push("one");
      });

    const result1 = await flow.run({}, { key: "key-1" });
    const result2 = await flow.run({}, { key: "key-1" });

    expect(result1.status).toBe("completed");
    expect(result2.status).toBe("completed");
    expect(calls).toHaveLength(1);
    expect(result1).toEqual(result2);
  });

  it("retorna erro cacheado se o fluxo falhou anteriormente", async () => {
    const store = createIdempotencyStore();
    let fail = true;
    
    const flow = create("fail-idempotent", { idempotency: store })
      .step("one", () => {
        if (fail) throw new Error("falhou");
      });

    const result1 = await flow.run({}, { key: "key-fail" });
    fail = false;
    const result2 = await flow.run({}, { key: "key-fail" });

    expect(result1.status).toBe("failed");
    expect(result2.status).toBe("failed");
    expect(result2.error).toEqual(result1.error);
  });

  it("permite re-executar se cacheResult for false", async () => {
    const store = createIdempotencyStore();
    let counter = 0;
    
    const flow = create("no-cache", { idempotency: store })
      .step("count", () => {
        counter++;
      });

    await flow.run({}, { key: "key-2", cacheResult: false });
    await flow.run({}, { key: "key-2", cacheResult: false });

    expect(counter).toBe(2);
  });

  it("lança erro se já estiver rodando e throwIfRunning for true", async () => {
    const store = createIdempotencyStore();
    
    const flow = create("running-test", { idempotency: store })
      .step("slow", () => new Promise(resolve => setTimeout(resolve, 100)));

    const promise1 = flow.run({}, { key: "key-running" });
    
    await expect(flow.run({}, { key: "key-running", throwIfRunning: true }))
      .rejects.toThrow("already running");

    await promise1;
  });

  it("limpa registros expirados", async () => {
    const store = createIdempotencyStore();
    const flow = create("ttl-test", { idempotency: store })
      .step("one", () => {});

    await flow.run({}, { key: "expired", ttlMs: 10 });
    
    // Aguarda expirar
    await new Promise(resolve => setTimeout(resolve, 20));
    
    const record = await store.get("expired");
    expect(record).toBeNull();
  });

  it("deve executar cleanup manual", async () => {
    const store = createIdempotencyStore();
    const flow = create("cleanup-test", { idempotency: store })
      .step("one", () => {});

    await flow.run({}, { key: "expired", ttlMs: 1 });
    await new Promise(resolve => setTimeout(resolve, 10));
    
    await store.cleanup();
    // Internamente foi removido.
  });

  it("lança erro se tentar completar registro inexistente no store em memória", async () => {
    const store = createIdempotencyStore();
    await expect(store.complete("missing", {})).rejects.toThrow(IdempotencyRecordNotFoundError);
  });

  it("lança erro se tentar falhar registro inexistente no store em memória", async () => {
    const store = createIdempotencyStore();
    await expect(store.fail("missing", {})).rejects.toThrow(IdempotencyRecordNotFoundError);
  });

  it("deve deletar um registro no store em memória", async () => {
    const store = createIdempotencyStore();
    await store.start("key");
    await store.delete("key");
    const record = await store.get("key");
    expect(record).toBeNull();
  });

  it("deve lidar com corrida no store (acquired: false)", async () => {
    const mockStore = {
      get: vi.fn().mockResolvedValue(null),
      start: vi.fn().mockResolvedValue({ acquired: false, record: { status: 'running' } }),
      complete: vi.fn(),
      fail: vi.fn(),
      delete: vi.fn(),
      cleanup: vi.fn(),
    };

    const flow = create("race-test", { idempotency: mockStore as any })
      .step("s1", () => {});

    const result = await flow.run({}, { key: "race" });
    expect(result.status).toBe("running");
  });

  it("deve remover registros expirados durante o start", async () => {
    const store = createIdempotencyStore();
    // Inicia um e faz ele expirar
    await store.start("exp-start", { ttlMs: 1 });
    await new Promise(r => setTimeout(r, 10));
    
    // Novo start deve disparar a limpeza interna
    await store.start("any-key");
    
    const record = await store.get("exp-start");
    expect(record).toBeNull();
  });
});
