# Getting Started

This guide walks through the current Orchestrix developer experience from installation to a first production-style flow.

## Prerequisites

- Node.js
- npm
- TypeScript if you want a typed development workflow

## Install dependencies for this repository

```bash
npm install
```

## Build the library

```bash
npm run build
```

## Your first flow

```ts
import { create } from "orchestrix";

type Input = {
  email: string;
};

const flow = create<Input>("welcome-user")
  .step("validate", (ctx) => {
    if (!ctx.input.email) {
      throw new Error("Email is required");
    }
  })
  .step("create-profile", async (ctx) => {
    ctx.set("profileId", "profile_123");
  })
  .step("send-email", async (ctx) => {
    const profileId = ctx.get<string>("profileId");
    if (!profileId) {
      throw new Error("Profile was not created");
    }
  });

const result = await flow.run({ email: "hello@example.com" });
```

## Understand the result

`flow.run()` returns a `FlowResult`:

```ts
type FlowResult = {
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  durationMs: number;
  steps: StepResult[];
  error?: unknown;
};
```

Each `StepResult` includes:

- `name`
- `status`
- `attempts`
- `durationMs`
- `error` when the step fails

## Add production behavior

### Retry flaky work

```ts
flow.step("call-provider", async () => {
  // external dependency
}, {
  retries: 4,
  retryDelayMs: 200,
  backoffFactor: "linear",
});
```

### Protect slow work with a timeout

```ts
flow.step("wait-for-service", async () => {
  // long call
}, {
  timeoutMs: 3_000,
});
```

### Roll back completed work

```ts
flow
  .step("reserve-inventory", async () => {
    // reserve stock
  }, {
    compensate: async () => {
      // release stock
    },
  })
  .step("capture-payment", async () => {
    // capture payment
  }, {
    compensate: async () => {
      // refund or void
    },
  });
```

### Make execution idempotent

```ts
import { create, createIdempotencyStore } from "orchestrix";

const store = createIdempotencyStore();

const paymentFlow = create("payment", {
  idempotency: store,
})
  .step("charge", async () => {
    // charge once
  });

await paymentFlow.run(
  { orderId: "123" },
  {
    key: "payment:123",
    ttlMs: 30 * 60 * 1000,
  }
);
```

## Next steps

- Read [Core Concepts](./core-concepts.md) for the mental model.
- Read [Execution Model](./guides/execution-model.md) for failure and compensation semantics.
- Read [API Reference](./api-reference.md) for the current public surface.
