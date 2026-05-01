# Execution Model

This guide explains how Orchestrix behaves while a flow is running.

## Sequential execution

Single steps run in the order they are registered.

```ts
const flow = create("order")
  .step("one", () => {})
  .step("two", () => {})
  .step("three", () => {});
```

The execution order is:

1. `one`
2. `two`
3. `three`

## Step lifecycle

For each step, Orchestrix:

1. emits `onStepStart`
2. marks the step as `running`
3. executes the function with retries and optional timeout
4. marks the step as `completed` or `failed`
5. emits `onStepComplete` or `onStepFail`

## Retry semantics

Retries happen inside the step execution wrapper.

Example:

```ts
flow.step("flaky", async () => {
  // may throw
}, {
  retries: 3,
  retryDelayMs: 100,
  backoffFactor: "exponential",
});
```

Delay strategies:

- `fixed`: same delay every retry
- `linear`: `retryDelayMs * (attempt + 1)`
- `exponential`: `retryDelayMs * 2^attempt`

If `jitter` is enabled, Orchestrix randomizes the delay up to the computed value.

## Timeout semantics

Timeout is evaluated per step attempt.

If a step exceeds `timeoutMs`, that attempt fails with a timeout error. If retries are configured, Orchestrix can retry the step again until retries are exhausted.

## Failure semantics

When a normal sequential step fails after all retries:

- the flow status becomes `failed`
- previously completed steps may be compensated
- the original error is returned as `FlowResult.error`

## Compensation order

Compensation runs in reverse order of previously completed steps.

```ts
create("rollback")
  .step("a", doA, { compensate: undoA })
  .step("b", doB, { compensate: undoB })
  .step("c", failC)
```

If `c` fails, compensation order is:

1. `undoB`
2. `undoA`

Compensation failures are ignored so the original flow failure remains the main result.

## Parallel semantics

Parallel groups start all contained steps concurrently and wait with `Promise.allSettled(...)`.

```ts
flow.parallel("parallel-work", [
  { name: "email", fn: sendEmail },
  { name: "log", fn: writeLog },
]);
```

### Default mode

Without options, a parallel group only fails the flow if all steps in the group fail.

This means a mixed result like one success and one failure still allows the flow to continue and complete.

### `failFast: true`

With `failFast: true`, any failed step causes the group to fail.

```ts
flow.parallel("parallel-work", steps, {
  failFast: true,
});
```

If the group fails:

- Orchestrix may compensate successful steps in that same parallel group when those steps define `compensate`
- Orchestrix then compensates previously completed sequential work

## Hook safety

Hooks are called with `safeCallHook(...)`.

That means:

- hooks can be async
- hooks can throw
- hook failures do not interrupt the flow

This is useful for telemetry, logging, and debugging.

## Idempotent execution entry point

Before the flow executes, Orchestrix can check the configured idempotency store.

Possible outcomes:

- cached completed result is returned immediately
- cached failed result is returned immediately when enabled
- a `running` result is returned for an in-flight duplicate run
- `FlowAlreadyRunningError` is thrown when `throwIfRunning` is `true`
- a fresh execution starts when the key is free
