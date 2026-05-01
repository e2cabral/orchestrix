# API Reference

This reference documents the public API exposed by the current source tree.

## Entry points

```ts
export { create } from "./core/create";
export { Flow } from "./core/flow";
export { FlowContext } from "./core/context";
export { createIdempotencyStore } from "./utils/idempotency";
export * from "./adapters/index";
export * from "./types";
export * from "./errors";
```

## `create`

```ts
create<TInput = unknown>(name: string, config?: FlowConfig): Flow<TInput>
```

Creates a new `Flow<TInput>`.

## `Flow`

### `new Flow(name, config?)`

Constructs a flow instance directly.

Most users should prefer `create(...)`.

### `flow.step(name, fn, options?)`

```ts
step(
  name: string,
  fn: (ctx: FlowContext<TInput>) => Promise<void> | void,
  options?: StepOptions<TInput>
): this
```

Registers a sequential step.

### `flow.parallel(name, steps, options?)`

```ts
parallel(
  name: string,
  steps: Step<TInput>[],
  options?: ParallelOptions
): this
```

Registers a parallel execution node.

### `flow.run(input, idempotencyOptions?)`

```ts
run(input: TInput, idempotencyOptions?: IdempotentRunOptions): Promise<FlowResult>
```

Executes the flow.

## `FlowContext`

### `new FlowContext(input)`

```ts
new FlowContext<TInput>(input: TInput)
```

### `context.input`

The original flow input.

### `context.get(key)`

```ts
get<TValue>(key: string): TValue | undefined
```

Reads a value from shared step state.

### `context.set(key, value)`

```ts
set<TValue>(key: string, value: TValue): void
```

Stores a value in shared step state.

### `context.has(key)`

```ts
has(key: string): boolean
```

Checks whether a key is present.

## Types

### `FlowConfig`

```ts
type FlowConfig = {
  idempotency?: IdempotencyStore;
  hooks?: FlowHooks<any>;
};
```

### `StepOptions<TInput>`

```ts
type StepOptions<TInput> = {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  backoffFactor?: "fixed" | "linear" | "exponential";
  jitter?: boolean;
  maxRetryDelayMs?: number;
  compensate?: (ctx: FlowContext<TInput>) => Promise<void> | void;
};
```

### `ParallelOptions`

```ts
type ParallelOptions = {
  failFast?: boolean;
};
```

### `IdempotentRunOptions`

```ts
type IdempotentRunOptions = {
  key: string;
  ttlMs?: number;
  cacheResult?: boolean;
  throwIfRunning?: boolean;
};
```

### `FlowStatus`

```ts
type FlowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
```

### `StepStatus`

```ts
type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
```

### `FlowResult`

```ts
type FlowResult = {
  name: string;
  status: FlowStatus;
  durationMs: number;
  steps: StepResult[];
  error?: unknown;
};
```

### `StepResult`

```ts
type StepResult = {
  name: string;
  status: StepStatus;
  attempts: number;
  durationMs: number;
  error?: unknown;
};
```

### `FlowHooks<TInput>`

```ts
type FlowHooks<TInput> = {
  onFlowStart?: (event: FlowStartEvent<TInput>) => void | Promise<void>;
  onFlowComplete?: (event: FlowCompleteEvent<TInput>) => void | Promise<void>;
  onFlowFail?: (event: FlowFailEvent<TInput>) => void | Promise<void>;
  onStepStart?: (event: StepStartEvent<TInput>) => void | Promise<void>;
  onStepComplete?: (event: StepCompleteEvent<TInput>) => void | Promise<void>;
  onStepFail?: (event: StepFailEvent<TInput>) => void | Promise<void>;
  onCompensate?: (event: CompensateEvent<TInput>) => void | Promise<void>;
  onCompensateComplete?: (event: CompensateCompleteEvent<TInput>) => void | Promise<void>;
};
```

## Idempotency stores

### `createIdempotencyStore()`

Creates the built-in in-memory implementation.

### `redisIdempotencyStore(redis)`

Creates a Redis-backed implementation.

### `dynamoIdempotencyStore(client, options)`

Creates a DynamoDB-backed implementation.

## Errors

Public error classes currently exported:

- `LocalFlowError`
- `StepAlreadyExistsError`
- `FlowAlreadyRunningError`
- `IdempotencyRecordNotFoundError`
- `StepTimeoutError`
