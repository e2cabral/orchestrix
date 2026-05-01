# Troubleshooting

This page covers the most common issues you may run into while working with Orchestrix.

## A step does not see data from a previous step

Make sure the earlier step writes to `FlowContext` with `ctx.set(...)` and the later step reads with the same key.

```ts
ctx.set("userId", "usr_123");
const userId = ctx.get<string>("userId");
```

## Duplicate step name error

Orchestrix requires unique step names across registered nodes.

If you see `StepAlreadyExistsError`, rename the duplicate step or parallel block content so every step name is unique.

## The flow is returning `running`

This happens when:

- idempotency is enabled
- the same idempotency key is already being processed
- `throwIfRunning` is not enabled

If you want an exception instead, run with:

```ts
await flow.run(input, {
  key: "my-key",
  throwIfRunning: true,
});
```

## A timeout error is returned

When `timeoutMs` is set, the step fails if execution exceeds that limit.

Options:

- increase `timeoutMs`
- reduce the external call latency
- add retries only if the timeout cause is temporary

## Compensation did not run for the failed step itself

This is expected.

Compensation is intended for work that already completed successfully before a later failure happened. A failed step is not treated as successfully committed work.

## A hook threw an error but the flow continued

This is also expected.

Orchestrix intentionally swallows hook errors so observability code cannot break business execution.

## Parallel group behavior is different from expected

Check the group mode:

- default mode only fails the flow if every step in the group fails
- `failFast: true` fails the flow when any step fails

If you want stricter semantics, make sure `failFast: true` is set.

## Redis or DynamoDB adapter is not working

Check the basics first:

- the client is initialized correctly
- network credentials are valid
- optional peer dependencies are installed
- the store is passed through `FlowConfig.idempotency`

For DynamoDB specifically:

- verify table name
- verify partition key configuration if you changed it
- verify TTL attribute setup if you rely on table expiration

## Tests are failing locally

Run:

```bash
npm test
```

If failures involve adapters, check whether the change affected current store semantics such as cached failed results, TTL handling, or duplicate-run detection.
