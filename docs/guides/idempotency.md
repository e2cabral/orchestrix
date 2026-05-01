# Idempotency Guide

Idempotency is one of the most important features in LocalFlow when flows interact with external systems.

It helps prevent duplicate work when the same request is retried by clients, queues, or webhooks.

## When to use it

Use idempotency for flows that:

- charge payments
- create orders
- process webhooks
- provision resources
- respond to retried HTTP requests

## In-memory store

The simplest option is the built-in in-memory store.

```ts
import { create, createIdempotencyStore } from "localflow";

const store = createIdempotencyStore();

const flow = create("order", {
  idempotency: store,
}).step("persist", async () => {
  // store order
});

const result = await flow.run(
  { orderId: "ord_001" },
  {
    key: "order:ord_001",
    ttlMs: 60_000,
  }
);
```

Best for:

- tests
- single-process apps
- local development

Not ideal for:

- horizontally scaled deployments
- durable cross-process coordination

## Redis adapter

Use Redis when you need a shared idempotency backend across application instances.

```ts
import { createClient } from "redis";
import { create, redisIdempotencyStore } from "localflow";

const redis = createClient();
await redis.connect();

const store = redisIdempotencyStore(redis);

const flow = create("payments", {
  idempotency: store,
});
```

Behavior notes:

- records are serialized as JSON
- `SET ... NX` is used during startup attempts
- Redis TTL can expire records automatically

## DynamoDB adapter

Use DynamoDB for cloud-native durable idempotency.

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { create, dynamoIdempotencyStore } from "localflow";

const client = new DynamoDBClient({});

const store = dynamoIdempotencyStore(client, {
  tableName: "localflow-idempotency",
});

const flow = create("provisioning", {
  idempotency: store,
});
```

Adapter options:

- `tableName`
- `partitionKey`
- `ttlAttribute`

Behavior notes:

- conditional writes are used to avoid duplicate acquisition
- DynamoDB TTL is supported through a TTL attribute, but expiration is not immediate
- the adapter performs a manual `expiresAt` check on reads

## Run options

Pass idempotent execution options to `flow.run(input, options)`.

```ts
await flow.run(input, {
  key: "order:123",
  ttlMs: 10 * 60 * 1000,
  cacheResult: true,
  throwIfRunning: false,
});
```

### `key`

Required unique identifier for the logical operation.

### `ttlMs`

Optional record expiration time in milliseconds.

### `cacheResult`

When `false`, LocalFlow deletes successful records instead of caching the completed result.

This is useful when you only want duplicate-run protection during execution, not replay of the final result.

### `throwIfRunning`

When `true`, a duplicate in-flight execution throws `FlowAlreadyRunningError`.

When `false`, LocalFlow returns a flow result with status `running`.

## Cached results

LocalFlow can return:

- a completed result from cache
- a failed result from cache

This behavior depends on the store record status and the run options.

## Choosing a store

- Use in-memory for tests and local-only scenarios.
- Use Redis for low-latency multi-instance deployments.
- Use DynamoDB for durable distributed systems already built on AWS.
