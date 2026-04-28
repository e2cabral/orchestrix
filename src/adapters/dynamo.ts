import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { IdempotencyRecord, IdempotencyStore } from "../types";
import { IdempotencyRecordNotFoundError } from "../errors";

/**
 * Options for the DynamoDB idempotency store.
 */
export interface DynamoDBStoreOptions {
  /** DynamoDB table name. */
  tableName: string;
  /** Partition key attribute name (default: 'key'). */
  partitionKey?: string;
  /** TTL attribute name for DynamoDB (default: 'ttl'). */
  ttlAttribute?: string;
}

/**
 * Creates an idempotency store implementation using DynamoDB.
 * 
 * @param client AWS SDK v3 DynamoDBClient instance.
 * @param options Table configurations.
 * @returns An IdempotencyStore instance.
 */
export function dynamoIdempotencyStore(
  client: DynamoDBClient,
  options: DynamoDBStoreOptions
): IdempotencyStore {
  const docClient = DynamoDBDocumentClient.from(client);
  const tableName = options.tableName;
  const pk = options.partitionKey || "key";
  const ttlAttr = options.ttlAttribute || "ttl";

  return {
    async get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null> {
      const response = await docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { [pk]: key },
        })
      );

      const item = response.Item;
      if (!item) return null;

      // Manual expiration check as DynamoDB TTL is not immediate
      if (item.expiresAt && item.expiresAt < Date.now()) {
        return null;
      }

      return {
        key: item[pk],
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        expiresAt: item.expiresAt,
        data: item.data,
        error: item.error,
      } as IdempotencyRecord<T>;
    },

    async start(
      key: string,
      startOptions?: { ttlMs?: number }
    ): Promise<{ acquired: boolean; record: IdempotencyRecord }> {
      const now = Date.now();
      const expiresAt = startOptions?.ttlMs ? now + startOptions.ttlMs : undefined;
      const ttl = expiresAt ? Math.floor(expiresAt / 1000) : undefined;

      const record: IdempotencyRecord = {
        key,
        status: "running",
        createdAt: now,
        updatedAt: now,
        expiresAt,
      };

      try {
        await docClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              [pk]: key,
              status: "running",
              createdAt: now,
              updatedAt: now,
              expiresAt,
              ...(ttl ? { [ttlAttr]: ttl } : {}),
            },
            // Condition: Key does not exist OR (status != 'running' AND (expiresAt is null OR already expired))
            ConditionExpression: `attribute_not_exists(#pk) OR (#status <> :running AND (attribute_not_exists(expiresAt) OR expiresAt < :now))`,
            ExpressionAttributeNames: {
              "#pk": pk,
              "#status": "status",
            },
            ExpressionAttributeValues: {
              ":running": "running",
              ":now": now,
            },
          })
        );
        return { acquired: true, record };
      } catch (error: any) {
        if (error.name === "ConditionalCheckFailedException") {
          const existing = await this.get(key);
          return { acquired: false, record: existing! };
        }
        throw error;
      }
    },

    async complete<T = unknown>(key: string, result: T): Promise<void> {
      const now = Date.now();
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { [pk]: key },
            UpdateExpression: "SET #status = :completed, #data = :data, updatedAt = :now",
            ConditionExpression: `attribute_exists(#pk)`,
            ExpressionAttributeNames: {
              "#pk": pk,
              "#status": "status",
              "#data": "data",
            },
            ExpressionAttributeValues: {
              ":completed": "completed",
              ":data": result,
              ":now": now,
            },
          })
        );
      } catch (error: any) {
        if (error.name === "ConditionalCheckFailedException") {
          throw new IdempotencyRecordNotFoundError(key);
        }
        throw error;
      }
    },

    async fail(key: string, error: unknown): Promise<void> {
      const now = Date.now();
      const errorData = error instanceof Error 
        ? { message: error.message, name: error.name, stack: error.stack }
        : error;

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { [pk]: key },
            UpdateExpression: "SET #status = :failed, #error = :error, updatedAt = :now",
            ConditionExpression: `attribute_exists(#pk)`,
            ExpressionAttributeNames: {
              "#pk": pk,
              "#status": "status",
              "#error": "error",
            },
            ExpressionAttributeValues: {
              ":failed": "failed",
              ":error": errorData,
              ":now": now,
            },
          })
        );
      } catch (err: any) {
        if (err.name === "ConditionalCheckFailedException") {
          throw new IdempotencyRecordNotFoundError(key);
        }
        throw err;
      }
    },

    async delete(key: string): Promise<void> {
      await docClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { [pk]: key },
        })
      );
    },

    async cleanup(): Promise<void> {
      // DynamoDB automatically manages TTL if configured on the table.
    },
  };
}
