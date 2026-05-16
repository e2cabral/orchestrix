# Orchestrix 🚀

Orchestrix is a lightweight, typed workflow orchestrator for Node.js and TypeScript.

It helps you model complex multi-step application flows with a small, fluent API and first-class support for retries, timeouts, compensation (rollback), idempotent execution, and lifecycle hooks.

---

## Why Orchestrix?

- **Fluent API**: Build workflows that are easy to read and maintain.
- **Typed Context**: Share state safely across steps with a runtime context.
- **Resilience**: Built-in retry logic with fixed, linear, or exponential backoff.
- **Safety**: Protect steps with timeouts and roll back work with compensation handlers.
- **Efficiency**: Avoid duplicate executions using pluggable idempotency stores (Redis, DynamoDB).
- **Observability**: Monitor execution with lifecycle hooks and a beautiful built-in logger.
- **Validation**: Ensure data integrity with Standard Schema v1 (Zod, Valibot, etc.).

---

## Quick Start

### Installation

```bash
npm install @eddiecbrl/orchestrix
```

### Your First Flow

```ts
import { create } from "@eddiecbrl/orchestrix";

type SignupInput = {
  email: string;
  plan: "free" | "pro";
};

const signupFlow = create<SignupInput>("signup")
  .step("validate-input", (ctx) => {
    if (!ctx.input.email) throw new Error("Email is required");
  })
  .step("create-user", async (ctx) => {
    const userId = "user_123";
    ctx.set("userId", userId); // Store data for next steps
  })
  .step("send-welcome-email", async (ctx) => {
    const userId = ctx.get<string>("userId");
    console.log(`Sending email to user ${userId}`);
  });

const result = await signupFlow.run({
  email: "team@example.com",
  plan: "pro",
});

console.log(result.status); // "completed"
```

---

## Core Features

### 🔄 Retries and Timeouts

Configure how unstable steps should behave. Orchestrix supports various backoff strategies and jitter.

```ts
flow.step("call-api", async () => { /* unstable work */ }, {
  retries: 3,
  retryDelayMs: 250,
  backoffFactor: "exponential", // "fixed" | "linear" | "exponential"
  jitter: true,
  maxRetryDelayMs: 5_000,
  timeoutMs: 10_000,
});
```

### ⏪ Compensation (Rollback)

Define how to undo work if a later step fails. Orchestrix executes compensation functions in reverse order.

```ts
flow
  .step("charge-card", async () => { /* ... */ }, {
    compensate: async (ctx) => { /* refund */ }
  })
  .step("provision-access", async () => {
    throw new Error("Failed to provision"); // Triggers compensation for 'charge-card'
  });
```

### 🆔 Idempotency

Avoid duplicate executions for the same request. Supports In-memory, Redis, and DynamoDB.

```ts
import { create, redisIdempotencyStore } from "@eddiecbrl/orchestrix";
import { createClient } from "redis";

const redis = createClient();
const store = redisIdempotencyStore(redis);

const flow = create("payment", { idempotency: store })
  .step("process", async () => { /* ... */ });

// Run with a unique key
await flow.run({ orderId: "123" }, { key: "order:123", ttlMs: 3600000 });
```

### ⚡ Parallel Execution

Run independent steps concurrently.

```ts
flow.parallel("batch-jobs", [
  { name: "job-1", fn: async () => { /* ... */ } },
  { name: "job-2", fn: async () => { /* ... */ } },
], { failFast: true });
```

### 🛡️ Input Validation

Use any library that supports [Standard Schema v1](https://github.com/standard-schema/standard-schema).

```ts
import { z } from "zod";

const schema = z.object({ email: z.string().email() });
const flow = create("validated-flow", { schema });

const result = await flow.run({ email: "invalid-email" });
console.log(result.status); // "failed"
```

### 🔌 Plugins and Lifecycle Hooks

Extend Orchestrix with custom logic or use the built-in logger.

```ts
const flow = create("my-flow", {
  logging: true, // Jest-style beautiful logs
  hooks: {
    onStepStart: (event) => console.log(`Starting ${event.stepName}`),
  },
  plugins: [
    {
      name: "my-plugin",
      onFlowComplete: (event) => { /* ... */ }
    }
  ]
});
```

---

## API Reference

### `create<TInput>(name: string, config?: FlowConfig)`
Factory to create a new flow.

### `FlowContext<TInput>`
- `input`: The original flow input.
- `get<T>(key: string)`: Retrieve shared state.
- `set<T>(key: string, value: T)`: Store shared state.
- `has(key: string)`: Check if key exists in state.
- `signal`: `AbortSignal` for cancellation check.

### `FlowResult`
- `status`: `'completed' | 'failed' | 'cancelled' | 'running'`.
- `durationMs`: Total execution time.
- `steps`: Array of `StepResult`.
- `error`: Root cause of failure if status is `'failed'`.

---

## Development

```bash
npm install     # Install dependencies
npm run build   # Build the library
npm test        # Run tests with 100% coverage
```

## License

MIT
