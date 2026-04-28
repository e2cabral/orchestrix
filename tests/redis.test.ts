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
    
    // Na implementação atual, ele não busca o registro de novo se o SET NX falhar.
    // E ele retorna acquired: true incorretamente.
    
    const result = await store.start("k");
    expect(result.acquired).toBe(false);
    expect(result.record).toBeDefined();
  });
});
