import { describe, expect, it, vi, beforeEach } from "vitest";
import { dynamoIdempotencyStore } from "../src/adapters/dynamo";
import { IdempotencyRecordNotFoundError } from "../src/errors";

const mockSend = vi.fn();

vi.mock("@aws-sdk/lib-dynamodb", () => {
  return {
    DynamoDBDocumentClient: {
      from: vi.fn(() => ({
        send: mockSend,
      })),
    },
    GetCommand: class {},
    PutCommand: class {},
    UpdateCommand: class {},
    DeleteCommand: class {},
  };
});

describe("DynamoDB Idempotency Store", () => {
  const tableName = "test-table";
  const store = dynamoIdempotencyStore({} as any, { tableName });

  beforeEach(() => {
    mockSend.mockReset();
  });

  it("deve obter um registro", async () => {
    const item = {
      key: "test-key",
      status: "completed",
      createdAt: 123,
      updatedAt: 456,
      data: { foo: "bar" },
    };

    mockSend.mockResolvedValueOnce({ Item: item });

    const result = await store.get("test-key");

    expect(result).toEqual({
      key: "test-key",
      status: "completed",
      createdAt: 123,
      updatedAt: 456,
      data: { foo: "bar" },
    });
    expect(mockSend).toHaveBeenCalled();
  });

  it("deve retornar null se o registro estiver expirado", async () => {
    const now = Date.now();
    const item = {
      key: "test-key",
      status: "completed",
      expiresAt: now - 1000,
    };

    mockSend.mockResolvedValueOnce({ Item: item });

    const result = await store.get("test-key");

    expect(result).toBeNull();
  });

  it("deve iniciar uma nova operação", async () => {
    mockSend.mockResolvedValueOnce({}); // PutCommand sucesso

    const result = await store.start("new-key");

    expect(result.acquired).toBe(true);
    expect(result.record.key).toBe("new-key");
    expect(result.record.status).toBe("running");
  });

  it("deve falhar ao iniciar se já estiver rodando", async () => {
    const error = new Error("ConditionalCheckFailedException");
    error.name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(error); // PutCommand falha

    const item = {
      key: "existing-key",
      status: "running",
      createdAt: 123,
    };
    mockSend.mockResolvedValueOnce({ Item: item }); // GetCommand retorna existente

    const result = await store.start("existing-key");

    expect(result.acquired).toBe(false);
    expect(result.record).toEqual({
        key: "existing-key",
        status: "running",
        createdAt: 123,
    });
  });

  it("deve concluir uma operação", async () => {
    mockSend.mockResolvedValueOnce({}); // UpdateCommand sucesso

    await store.complete("test-key", { result: "ok" });

    expect(mockSend).toHaveBeenCalled();
  });

  it("deve lançar erro ao concluir registro inexistente", async () => {
    const error = new Error("ConditionalCheckFailedException");
    error.name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(error);

    await expect(store.complete("missing-key", {}))
      .rejects.toThrow(IdempotencyRecordNotFoundError);
  });

  it("deve marcar como falha uma operação", async () => {
    mockSend.mockResolvedValueOnce({}); // UpdateCommand sucesso

    await store.fail("test-key", new Error("failed"));

    expect(mockSend).toHaveBeenCalled();
  });

  it("deve deletar um registro", async () => {
    mockSend.mockResolvedValueOnce({});
    await store.delete("test-key");
    expect(mockSend).toHaveBeenCalled();
  });
});
