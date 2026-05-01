# Examples

This page collects practical patterns built from the current Orchestrix API.

## Signup flow

```ts
import { create } from "orchestrix";

type SignupInput = {
  email: string;
  name: string;
};

const signupFlow = create<SignupInput>("signup")
  .step("validate", (ctx) => {
    if (!ctx.input.email) throw new Error("Email is required");
    if (!ctx.input.name) throw new Error("Name is required");
  })
  .step("create-user", async (ctx) => {
    ctx.set("userId", "usr_123");
  })
  .parallel("after-signup", [
    {
      name: "send-email",
      fn: async () => {},
    },
    {
      name: "write-audit-log",
      fn: async () => {},
    },
  ]);
```

## Payment flow with rollback

```ts
import { create } from "orchestrix";

const paymentFlow = create("payment")
  .step("reserve-inventory", async () => {
    // reserve stock
  }, {
    compensate: async () => {
      // release stock
    },
  })
  .step("charge-card", async () => {
    // capture payment
  }, {
    retries: 3,
    retryDelayMs: 500,
    backoffFactor: "exponential",
    compensate: async () => {
      // refund payment
    },
  })
  .step("provision-license", async () => {
    // create entitlement
  }, {
    compensate: async () => {
      // revoke entitlement
    },
  });
```

## Idempotent webhook processor

```ts
import { create, createIdempotencyStore } from "orchestrix";

const store = createIdempotencyStore();

const webhookFlow = create("stripe-webhook", {
  idempotency: store,
})
  .step("parse-event", async () => {})
  .step("apply-business-update", async () => {});

export async function handleWebhook(event: { id: string }) {
  return webhookFlow.run(event, {
    key: `stripe:${event.id}`,
    ttlMs: 24 * 60 * 60 * 1000,
    throwIfRunning: true,
  });
}
```

## Hooks for logging

```ts
import { create } from "orchestrix";

const flow = create("logged-flow", {
  hooks: {
    onFlowStart: ({ flowName }) => console.log("flow:start", flowName),
    onStepStart: ({ stepName }) => console.log("step:start", stepName),
    onStepComplete: ({ stepName }) => console.log("step:complete", stepName),
    onStepFail: ({ stepName, error }) => console.error("step:fail", stepName, error),
    onFlowComplete: ({ result }) => console.log("flow:complete", result.status),
  },
});
```

## Parallel group with strict failure handling

```ts
import { create } from "orchestrix";

const flow = create("fanout").parallel("notifications", [
  {
    name: "send-email",
    fn: async () => {},
    options: {
      compensate: async () => {},
    },
  },
  {
    name: "publish-event",
    fn: async () => {
      throw new Error("Broker unavailable");
    },
  },
], {
  failFast: true,
});
```

In this configuration, any failed step in the parallel group fails the flow.
