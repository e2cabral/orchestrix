# Core Concepts

This page explains the building blocks behind Orchestrix.

## Flow

A flow is an ordered collection of named execution nodes.

Nodes can be:

- a single step
- a parallel group of steps

You create a flow with:

```ts
import { create } from "orchestrix";

const flow = create("my-flow");
```

The flow name is included in results and lifecycle hook events.

## Step

A step is the smallest unit of work in Orchestrix.

```ts
flow.step("create-record", async (ctx) => {
  // work
});
```

Each step has:

- a unique name
- an execution function
- optional runtime behavior like retries, timeout, and compensation

Step names must be unique across the whole flow. Orchestrix throws `StepAlreadyExistsError` when a duplicate is registered.

## FlowContext

`FlowContext<TInput>` is the shared runtime object passed to every step.

It contains:

- `input`: the original input payload
- `get(key)`: read from shared state
- `set(key, value)`: write shared state
- `has(key)`: check if a key exists

Example:

```ts
type Input = { email: string };

create<Input>("ctx-demo")
  .step("write", (ctx) => {
    ctx.set("email", ctx.input.email);
  })
  .step("read", (ctx) => {
    const email = ctx.get<string>("email");
  });
```

## Step result

Each executed step produces a `StepResult`.

```ts
type StepResult = {
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  attempts: number;
  durationMs: number;
  error?: unknown;
};
```

## Flow result

Each flow run returns a `FlowResult`.

```ts
type FlowResult = {
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  durationMs: number;
  steps: StepResult[];
  error?: unknown;
};
```

## Retry model

Retries are defined per step.

Available controls:

- `retries`
- `retryDelayMs`
- `backoffFactor`
- `jitter`
- `maxRetryDelayMs`

Retry attempts are counted in the final `StepResult.attempts`.

## Timeout model

When `timeoutMs` is present, Orchestrix races the step execution against a timeout promise.

If the timeout wins:

- the step fails
- the flow may trigger compensation if earlier steps succeeded
- the timeout error is reported in the failed `StepResult`

## Compensation model

Compensation lets a step define rollback logic for work that already succeeded.

```ts
flow.step("create-user", async () => {
  // create
}, {
  compensate: async () => {
    // delete
  },
});
```

When a later step fails, Orchestrix compensates previously completed steps in reverse order.

Compensation errors do not replace the original flow failure.

## Parallel groups

Parallel groups let independent steps run concurrently.

```ts
flow.parallel("notifications", [
  { name: "send-email", fn: async () => {} },
  { name: "write-audit-log", fn: async () => {} },
]);
```

Important behavior:

- all steps inside the group are started together
- the group waits for all step promises to settle
- each step still gets an individual `StepResult`
- failure semantics depend on `failFast`

Default group failure behavior:

- the flow fails only if every step in the group fails

With `failFast: true`:

- any failed step marks the group as failed

## Hooks

Hooks are optional callbacks defined on `FlowConfig`.

They let you observe the execution lifecycle without changing step code.

Available hooks:

- `onFlowStart`
- `onFlowComplete`
- `onFlowFail`
- `onStepStart`
- `onStepComplete`
- `onStepFail`
- `onCompensate`
- `onCompensateComplete`

Hook failures are swallowed internally, so a broken observer does not break the flow.

## Idempotency

Idempotency allows repeated calls with the same key to behave safely.

Orchestrix supports:

- an in-memory store
- a Redis store
- a DynamoDB store

With idempotency enabled:

- completed results can be returned from cache
- failed results can also be cached
- concurrent duplicate runs can return `running` or throw `FlowAlreadyRunningError`

## Input Validation (Schema)

Orchestrix supports input validation before any step is executed using the [Standard Schema](https://github.com/standard-schema/standard-schema) protocol.

When a `schema` is provided in `FlowConfig`:

- it is validated immediately when `run()` is called
- if validation fails, the flow returns a `failed` result without executing any steps
- the error will be a `FlowValidationError` containing the list of validation issues

This ensures steps always receive data that conforms to your expectations.
