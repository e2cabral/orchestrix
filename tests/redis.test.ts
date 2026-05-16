import { describe, expect, it, vi, beforeEach } from "vitest";
import { redisIdempotencyStore } from "../src/adapters/redis";
import { IdempotencyRecordNotFoundError } from "../src/errors";

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();
const mockPTTL = vi.fn();

const mockRedis = {
  get: mockGet,
  set: mockSet,
  del: mockDel,
  pTTL: mockPTTL,
} as any;

describe("Redis Idempotency Store", () => {
  const store = redisIdempotencyStore(mockRedis);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("deve obter um registro", async () => {
    const record = { key: "k", status: "completed" };
    mockGet.mockResolvedValueOnce(JSON.stringify(record));

    const result = await store.get("k");
    expect(result).toEqual(record);
  });

  it("deve retornar null se não existir", async () => {
    mockGet.mockResolvedValueOnce(null);
    const result = await store.get("k");
    expect(result).toBeNull();
  });

  it("deve iniciar uma nova operação (sucesso NX)", async () => {
    mockGet.mockResolvedValueOnce(null);
    mockSet.mockResolvedValueOnce("OK");

    const result = await store.start("k", { ttlMs: 1000 });

    expect(result.acquired).toBe(true);
    expect(mockSet).toHaveBeenCalledWith("k", expect.any(String), expect.objectContaining({ NX: true, PX: 1000 }));
  });

  it("deve retornar acquired: false se já estiver rodando", async () => {
    const existing = { key: "k", status: "running" };
    mockGet.mockResolvedValueOnce(JSON.stringify(existing));

    const result = await store.start("k");

    expect(result.acquired).toBe(false);
    expect(result.record).toEqual(existing);
  });

  it("BUG: deve retornar acquired: false se SET NX falhar (alguém ganhou a corrida)", async () => {
    mockGet.mockResolvedValueOnce(null);
    mockSet.mockResolvedValueOnce(null); // SET NX falhou
    
    const existing = { key: "k", status: "running" };
    mockGet.mockResolvedValueOnce(JSON.stringify(existing));
    
    const result = await store.start("k");
    expect(result.acquired).toBe(false);
    expect(result.record).toEqual(existing);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("deve concluir um registro", async () => {
    const record = { key: "k", status: "running" };
    mockGet.mockResolvedValueOnce(JSON.stringify(record));
    mockPTTL.mockResolvedValueOnce(1000);
    mockSet.mockResolvedValueOnce("OK");

    await store.complete("k", { data: 1 });

    expect(mockSet).toHaveBeenCalledWith("k", expect.stringContaining("\"status\":\"completed\""), { PX: 1000 });
  });

  it("deve marcar como falha um registro", async () => {
    const record = { key: "k", status: "running" };
    mockGet.mockResolvedValueOnce(JSON.stringify(record));
    mockPTTL.mockResolvedValueOnce(1000);
    mockSet.mockResolvedValueOnce("OK");

    await store.fail("k", new Error("fail"));

    expect(mockSet).toHaveBeenCalledWith("k", expect.stringContaining("\"status\":\"failed\""), { PX: 1000 });
  });

  it("deve deletar um registro", async () => {
    mockDel.mockResolvedValueOnce(1);
    await store.delete("k");
    expect(mockDel).toHaveBeenCalledWith("k");
  });

  it("deve lançar erro se tentar completar registro inexistente", async () => {
    mockGet.mockResolvedValueOnce(null);
    await expect(store.complete("k", {})).rejects.toThrow(IdempotencyRecordNotFoundError);
  });

  it("deve deletar se tentar completar registro já expirado", async () => {
    const record = { key: "k", status: "running", expiresAt: Date.now() - 1000 };
    mockGet.mockResolvedValueOnce(JSON.stringify(record));
    mockDel.mockResolvedValueOnce(1);

    await store.complete("k", {});
    expect(mockDel).toHaveBeenCalledWith("k");
  });

  it("deve lançar erro se tentar falhar registro inexistente", async () => {
    mockGet.mockResolvedValueOnce(null);
    await expect(store.fail("k", {})).rejects.toThrow(IdempotencyRecordNotFoundError);
  });

  it("deve lidar com erro customizado ao falhar", async () => {
    const record = { key: "k", status: "running" };
    mockGet.mockResolvedValueOnce(JSON.stringify(record));
    mockPTTL.mockResolvedValueOnce(1000);
    mockSet.mockResolvedValueOnce("OK");

    await store.fail("k", "string error");

    expect(mockSet).toHaveBeenCalledWith("k", expect.stringContaining("\"message\":\"string error\""), { PX: 1000 });
  });

  it("cleanup não deve fazer nada", async () => {
    await expect(store.cleanup()).resolves.toBeUndefined();
  });
});
