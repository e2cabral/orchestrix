# Orchestrix

Orchestrix is a lightweight workflow orchestrator for Node.js and TypeScript.

It helps you model multi-step application flows with a small, typed API and first-class support for retries, timeouts, compensation, idempotent execution, lifecycle hooks, and parallel step groups.

## Why Orchestrix

- Build workflows with a fluent, readable API.
- Share state safely across steps with a typed runtime context.
- Retry unstable operations with fixed, linear, or exponential backoff.
- Protect slow steps with timeouts.
- Roll back completed work with compensation handlers.
- Avoid duplicate executions with pluggable idempotency stores.
- Observe flow execution with hooks instead of framework-specific event systems.
- Validate input payloads with any Standard Schema v1 library (Zod, Valibot, etc.).

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Feature Snapshot](#feature-snapshot)
- [Development](#development)
- [Project Status](#project-status)

## Overview

Orchestrix is designed for application-level orchestration:

- signup flows
- payment pipelines
- provisioning sequences
- sync jobs
- internal business processes

Each flow is composed of named steps. A step can:

- read the input payload
- write and read shared context state
- define retry and timeout behavior
- register a compensation function for rollback

Flows can also define parallel groups for independent operations that should run concurrently.

## Quick Start

### Create a flow

```ts
import { create } from "orchestrix";

type SignupInput = {
  email: string;
  plan: "free" | "pro";
};

const signupFlow = create<SignupInput>("signup")
  .step("validate-input", (ctx) => {
    if (!ctx.input.email) {
      throw new Error("Email is required");
    }
  })
  .step("create-user", async (ctx) => {
    const userId = "user_123";
    ctx.set("userId", userId);
  })
  .step("send-welcome-email", async (ctx) => {
    const userId = ctx.get<string>("userId");
    if (!userId) {
      throw new Error("Missing userId in context");
    }
  });

const result = await signupFlow.run({
  email: "team@example.com",
  plan: "pro",
});

console.log(result.status);
console.log(result.steps);
```

### Add retries and timeouts

```ts
import { create } from "orchestrix";

const flow = create("external-sync").step(
  "call-api",
  async () => {
    // unstable network call
  },
  {
    retries: 3,
    retryDelayMs: 250,
    backoffFactor: "exponential",
    jitter: true,
    maxRetryDelayMs: 5_000,
    timeoutMs: 10_000,
  }
);
```

### Add compensation

```ts
import { create } from "orchestrix";

const flow = create("purchase")
  .step(
    "charge-card",
    async () => {
      // charge payment provider
    },
    {
      compensate: async () => {
        // refund if a later step fails
      },
    }
  )
  .step("provision-access", async () => {
    throw new Error("Provisioning failed");
  });
```

### Run with idempotency

```ts
import { create, createIdempotencyStore } from "orchestrix";

const store = createIdempotencyStore();

const flow = create("order-processing", {
  idempotency: store,
}).step("persist-order", async () => {
  // write order
});

const result = await flow.run(
  { orderId: "ord_123" },
  {
    key: "order:ord_123",
    ttlMs: 60 * 60 * 1000,
  }
);
```

### Validate input with Schema

```ts
import { create } from "orchestrix";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  plan: z.enum(["free", "pro"]),
});

const flow = create("validated-signup", { schema })
  .step("process", async (ctx) => {
    // input is guaranteed to be valid here
    console.log(ctx.input.email);
  });

const result = await flow.run({
  email: "invalid-email",
  plan: "pro",
});

console.log(result.status); // "failed"
console.log(result.error);  // FlowValidationError
```

### Cancellation Support (AbortSignal)

```ts
const controller = new AbortController();

const flow = create("cancellable-flow")
  .step("long-running", async (ctx) => {
    // steps can check if they should stop
    if (ctx.signal?.aborted) return;
    // ... logic
  });

// Cancel the flow externally
setTimeout(() => controller.abort("User changed their mind"), 500);

const result = await flow.run({}, { signal: controller.signal });

console.log(result.status); // "cancelled"
```

### Parallel execution

```ts
const flow = create("parallel-flow")
  .parallel("batch-jobs", [
    { name: "job-1", run: async () => { /* ... */ } },
    { name: "job-2", run: async () => { /* ... */ } },
  ], { failFast: true });

await flow.run({});
```

### Lifecycle Hooks

```ts
const flow = create("hooked-flow", {
  hooks: {
    onFlowStart: (event) => console.log(`Flow ${event.flowName} started`),
    onStepFailure: (event) => console.error(`Step ${event.stepName} failed:`, event.error),
  }
})
.step("do-something", async () => { /* ... */ });

await flow.run({});
```

### Plugins / Middleware

Orchestrix supports a plugin system that allows you to extend the flow behavior with cross-cutting concerns like logging, metrics, or authentication.

```ts
import { create, createConsoleLoggerPlugin } from "orchestrix";

const flow = create("my-flow", {
  plugins: [
    createConsoleLoggerPlugin({ prefix: "APP" }),
    {
      name: "my-custom-plugin",
      onStepStart: (event) => {
        console.log(`Step ${event.stepName} is starting...`);
      }
    }
  ]
});

await flow.run({});
```

### Built-in Logging (Jest-style)

Orchestrix includes a built-in logger that provides clear, color-coded output for your flows, inspired by the Jest output format.

```ts
const flow = create("my-flow", { 
  logging: true // Enable with default options
});

// Or with options
const flow = create("my-flow", {
  logging: {
    enabled: true,
    prefix: "WORKER-1"
  }
});
```

Example output:
```text
RUNS my-flow
  ✓ step-1 (150ms)
  ✓ step-2 (2.4s) (2 retries)
  ✕ step-3 (10ms) (1 attempts)
    Error: service unavailable

FAIL my-flow
Steps:    2 passed, 1 failed, 3 total
Time:     2.56s
----------------------------------------
```

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Core Concepts](./docs/core-concepts.md)
- [Execution Model](./docs/guides/execution-model.md)
- [Idempotency Guide](./docs/guides/idempotency.md)
- [Hooks and Observability](./docs/guides/hooks-and-observability.md)
- [Examples](./docs/examples.md)
- [API Reference](./docs/api-reference.md)
- [Troubleshooting](./docs/troubleshooting.md)

## Feature Snapshot

### Sequential steps

Steps are executed in registration order.

### Shared context

Each flow run gets a `FlowContext<TInput>` with:

- `input`
- `get(key)`
- `set(key, value)`
- `has(key)`

### Retries

Per-step retries support:

- `retries`
- `retryDelayMs`
- `backoffFactor: "fixed" | "linear" | "exponential"`
- `jitter`
- `maxRetryDelayMs`

### Timeouts

Use `timeoutMs` on a step to fail long-running work.

### Compensation

If a later step fails, previously completed steps can be compensated in reverse order.

### Input Validation

Validate flow input using any library that supports [Standard Schema v1](https://github.com/standard-schema/standard-schema).

### Parallel groups

Run independent steps concurrently with `.parallel(name, steps, options)`.

By default, a parallel group only fails the flow when all steps in that group fail. With `failFast: true`, any failed step marks the group as failed.

### Hooks

Orchestrix supports lifecycle hooks for:

- flow start
- flow completion
- flow failure
- step start
- step completion
- step failure
- compensation start
- compensation completion

### Plugins

Extend the library with reusable middleware and extensions.

### Idempotency stores

Built-in options:

- in-memory store
- Redis adapter
- DynamoDB adapter

## Development

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Run tests

```bash
npm test
```

### Type-check

```bash
npm run typecheck
```

## Project Status

Orchestrix already includes the core orchestration primitives documented above.

The repository also contains a roadmap in [NEXT_STEPS.md](./NEXT_STEPS.md) with ideas such as cancellation support, richer errors, middleware, and deeper observability. Those items are not presented as stable features in this documentation unless they are implemented in the current source code.
