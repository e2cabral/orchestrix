# Hooks and Observability

Hooks are the built-in observability surface in LocalFlow.

They let you react to lifecycle events without mixing logging or telemetry logic into the workflow steps themselves.

## Define hooks

```ts
import { create } from "localflow";

const flow = create("hooks-demo", {
  hooks: {
    onFlowStart: ({ flowName }) => {
      console.log("started", flowName);
    },
    onStepStart: ({ stepName }) => {
      console.log("step:start", stepName);
    },
    onStepComplete: ({ stepName, result }) => {
      console.log("step:complete", stepName, result);
    },
    onStepFail: ({ stepName, error }) => {
      console.error("step:fail", stepName, error);
    },
    onCompensate: ({ stepName }) => {
      console.log("compensate:start", stepName);
    },
    onCompensateComplete: ({ stepName }) => {
      console.log("compensate:complete", stepName);
    },
    onFlowComplete: ({ result }) => {
      console.log("done", result);
    },
    onFlowFail: ({ result }) => {
      console.error("flow failed", result);
    },
  },
});
```

## Available lifecycle events

### Flow hooks

- `onFlowStart`
- `onFlowComplete`
- `onFlowFail`

### Step hooks

- `onStepStart`
- `onStepComplete`
- `onStepFail`

### Compensation hooks

- `onCompensate`
- `onCompensateComplete`

## Event payload shape

Each hook receives a structured event object with the current flow name, input, context, and event-specific data.

Examples:

- `StepStartEvent<TInput>`
- `StepCompleteEvent<TInput>`
- `StepFailEvent<TInput>`
- `FlowStartEvent<TInput>`
- `FlowCompleteEvent<TInput>`
- `FlowFailEvent<TInput>`
- `CompensateEvent<TInput>`
- `CompensateCompleteEvent<TInput>`

## Design behavior

LocalFlow executes hooks with an internal safe wrapper.

That means:

- hooks may be synchronous or async
- hook failures are swallowed
- business execution is not blocked by observer failures

This design is helpful for:

- logs
- metrics
- audit trails
- dev diagnostics

## Practical patterns

### Structured logging

```ts
onStepComplete: ({ flowName, stepName, result }) => {
  logger.info({
    flowName,
    stepName,
    result,
  });
};
```

### Metrics

```ts
onFlowComplete: ({ flowName, result }) => {
  metrics.timing(`flows.${flowName}.duration_ms`, result.durationMs);
};
```

### Failure reporting

```ts
onStepFail: ({ flowName, stepName, error }) => {
  errorTracker.captureException(error, {
    tags: { flowName, stepName },
  });
};
```

## Current scope

Hooks are the current built-in observability mechanism.

The project roadmap mentions richer tracing and plugin-style extensions, but the documentation in this repository only treats hooks as part of the implemented public API today.
