# LocalFlow

LocalFlow is a lightweight workflow orchestrator for Node.js and TypeScript.

It helps you model multi-step application flows with a small, typed API and first-class support for retries, timeouts, compensation, idempotent execution, lifecycle hooks, and parallel step groups.

## Why LocalFlow

- Build workflows with a fluent, readable API.
- Share state safely across steps with a typed runtime context.
- Retry unstable operations with fixed, linear, or exponential backoff.
- Protect slow steps with timeouts.
- Roll back completed work with compensation handlers.
- Avoid duplicate executions with pluggable idempotency stores.
- Observe flow execution with hooks instead of framework-specific event systems.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Feature Snapshot](#feature-snapshot)
- [Development](#development)
- [Project Status](#project-status)

## Overview

LocalFlow is designed for application-level orchestration:

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
import { create } from "localflow";

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
import { create } from "localflow";

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
import { create } from "localflow";

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
import { create, createIdempotencyStore } from "localflow";

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

### Parallel groups

Run independent steps concurrently with `.parallel(name, steps, options)`.

By default, a parallel group only fails the flow when all steps in that group fail. With `failFast: true`, any failed step marks the group as failed.

### Hooks

LocalFlow supports lifecycle hooks for:

- flow start
- flow completion
- flow failure
- step start
- step completion
- step failure
- compensation start
- compensation completion

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

LocalFlow already includes the core orchestration primitives documented above.

The repository also contains a roadmap in [NEXT_STEPS.md](./NEXT_STEPS.md) with ideas such as schema validation, cancellation support, richer errors, middleware, and deeper observability. Those items are not presented as stable features in this documentation unless they are implemented in the current source code.
