import {
  FlowConfig,
  FlowResult,
  Step,
  StepOptions,
  StepResult,
  IdempotentRunOptions,
  IdempotentRunResult,
  FlowNode,
  ParallelOptions, FlowStartEvent, FlowCompleteEvent, FlowFailEvent, CompensateEvent, CompensateCompleteEvent,
  StepStartEvent, StepCompleteEvent, StepStatus, StepFailEvent
} from "../types";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {FlowContext} from "./context";
import {runWithRetry} from "../utils/retry";
import {runWithTimeout} from "../utils/timeout";
import {State} from "./state";
import {FlowAlreadyRunningError, FlowValidationError, StepAlreadyExistsError} from "../errors";
import {safeCallHook} from "../utils/hooks";
import {FlowLogger} from "../utils/logger";

/**
 * Main class for defining and executing workflows.
 * @template TInput The type of the flow input data.
 */
export class Flow<TInput = unknown> {
  private nodes: FlowNode<TInput>[] = [];

  /**
   * @param name Flow name.
   * @param config Optional flow configurations.
   */
  constructor(
    public readonly name: string,
    public readonly config: FlowConfig = {}
  ) {
  }

  /**
   * Adds a new step to the flow.
   * @param name Unique step name.
   * @param fn Function to be executed in this step.
   * @param options Step configuration options (retry, timeout, compensation).
   * @returns The Flow instance for chaining.
   * @throws Error if a step with the same name already exists.
   */
  step(name: string, fn: Step<TInput>['fn'], options?: StepOptions<TInput>): this {
    const stepAlreadyExists = this.nodes.some(node => {
      switch (node.type) {
        case 'step':
          return node.step.name === name;
        case 'parallel':
          return node.steps.some(step => step.name === name);
      }
    });

    if (stepAlreadyExists) {
      throw new StepAlreadyExistsError(name);
    }

    this.nodes.push({type: 'step', step: {name, fn, options}});
    return this;
  }

  /**
   * Defines a set of steps to be executed in parallel.
   *
   * @param name - The unique name for this parallel execution block.
   * @param steps - The list of steps to execute concurrently.
   * @param options - The options to execute concurrently
   * @returns The flow instance for chaining.
   * @throws {StepAlreadyExistsError} If a step or parallel block with the same name already exists.
   */
  parallel(name: string, steps: Step<TInput>[], options?: ParallelOptions) {
    const stepAlreadyExists = this.nodes.some(node => {
      switch (node.type) {
        case 'step':
          return node.step.name === name;
        case 'parallel':
          return node.steps.some(step => step.name === name);
      }
    });

    if (stepAlreadyExists) {
      throw new StepAlreadyExistsError(name);
    }

    this.nodes.push({type: 'parallel', steps, options});
    return this;
  }

  /**
   * Runs the flow with the provided data.
   * @param input Input data for the flow.
   * @param options Options for idempotent execution and optional signal to cancel the flow.
   * @returns Consolidated result of the flow execution.
   */
  async run(input: TInput, options?: IdempotentRunOptions & { signal?: AbortSignal }): Promise<FlowResult> {
    const startedAt = Date.now();
    const signal = options?.signal;

    let logger: FlowLogger | undefined;
    if (this.config.logging) {
      const logOptions = typeof this.config.logging === "boolean"
        ? { enabled: this.config.logging }
        : this.config.logging;
      logger = new FlowLogger(logOptions);
    }

    if (this.config.schema) {
      const result = await this.config.schema['~standard'].validate(input);
      if (result.issues) {
        const error = new FlowValidationError(result.issues as unknown[]);
        const flowResult: FlowResult = {
          name: this.name,
          status: 'failed',
          durationMs: Date.now() - startedAt,
          steps: [],
          error
        };

        if (logger) {
          logger.onFlowFail({
            flowName: this.name,
            input,
            context: new FlowContext(input, signal),
            result: error
          });
        }

        return flowResult;
      }
    }

    const flattenedNodes = this.nodes.flatMap(node => {
      if (node.type === 'parallel') {
        return node.steps;
      }
      return node.step;
    });

    const ctx = new FlowContext(input, signal);
    const manager = new State(flattenedNodes);
    const results: StepResult[] = [];
    const executedSteps: Step<TInput>[] = [];

    await safeCallHook<FlowStartEvent<TInput>>(
      this.config.hooks?.onFlowStart,
      { flowName: this.name, input, context: ctx }
    )

    if (logger) {
      logger.onFlowStart({ flowName: this.name, input, context: ctx }, flattenedNodes.length);
    }

    const cached = await this.preRunIdempotency(input, options);
    if (cached) return cached;

    let result: FlowResult = {
      name: this.name,
      status: "pending",
      durationMs: 0,
      steps: results
    };

    try {
      for (const node of this.nodes) {
        if (signal?.aborted) {
          await this.handleStepFailure(signal.reason, ctx, manager, executedSteps, input, logger);
          result = {
            name: this.name,
            status: "cancelled",
            durationMs: Date.now() - startedAt,
            steps: results,
            error: signal.reason
          };

          if (logger) {
            logger.onFlowComplete({ flowName: this.name, input, context: ctx, result });
          }

          return result;
        }

        let stepResult: StepResult | undefined;
        let stepResults: StepResult[] = [];

        switch (node.type) {
          case "step":
            stepResult = await this.executeStep(node.step, ctx, manager, input, logger);
            results.push(stepResult);
            break;
          case "parallel":
            stepResults = await this.executeParallelSteps(node.steps, ctx, manager, input, node.options, logger);
            results.push(...stepResults);
            
            const failedSteps = stepResults.filter(s => s.status === 'failed');
            
            if (node.options?.failFast) {
              stepResult = failedSteps.length > 0 ? failedSteps[0] : undefined;
            } else {
              stepResult = failedSteps.length === node.steps.length ? failedSteps[0] : undefined;
            }
            break;
        }

        if (!stepResult && stepResults.length === 0) {
          continue;
        }

        if (stepResult?.status === 'failed') {
          if (node.type === 'parallel') {
            for (const step of node.steps) {
              if (step.name !== stepResult.name && step.options?.compensate && manager.get(step.name)?.status === 'completed') {
                try {
                  await safeCallHook<CompensateEvent<TInput>>(
                    this.config.hooks?.onCompensate,
                    {
                      flowName: this.name,
                      stepName: step.name,
                      input,
                      context: ctx,
                      error: stepResult.error
                    }
                  )

                  if (logger) {
                    logger.onCompensate({
                      flowName: this.name,
                      stepName: step.name,
                      input,
                      context: ctx,
                      error: stepResult.error
                    });
                  }

                  await step.options.compensate(ctx);
                  manager.update(step, 'cancelled');

                  await safeCallHook<CompensateCompleteEvent<TInput>>(
                    this.config.hooks?.onCompensateComplete,
                    {
                      flowName: this.name,
                      stepName: step.name,
                      input,
                      context: ctx,
                      result: stepResult.error
                    }
                  )
                } catch (e) {
                  // Ignore compensation error
                }
              }
            }
          }

          await this.handleStepFailure(stepResult.error, ctx, manager, executedSteps, input, logger);

          result = {
            name: this.name,
            status: "failed",
            durationMs: Date.now() - startedAt,
            steps: results,
            error: stepResult.error
          };

          await this.postRunIdempotency(result, options);

          await safeCallHook<FlowFailEvent<TInput>>(
            this.config.hooks?.onFlowFail,
            { flowName: this.name, input, context: ctx, result: stepResult.error }
          )

          if (logger) {
            logger.onFlowComplete({ flowName: this.name, input, context: ctx, result });
          }

          return result;
        }

        executedSteps.push(...(node.type === 'step' ? [node.step] : node.steps));
      }

      if (signal?.aborted) {
        await this.handleStepFailure(signal.reason, ctx, manager, executedSteps, input, logger);
        const cancelResult: FlowResult = {
          name: this.name,
          status: "cancelled",
          durationMs: Date.now() - startedAt,
          steps: results,
          error: signal.reason
        };

        if (logger) {
          logger.onFlowComplete({ flowName: this.name, input, context: ctx, result: cancelResult });
        }

        return cancelResult;
      }

      result = {
        name: this.name,
        status: "completed",
        durationMs: Date.now() - startedAt,
        steps: results
      };

      await this.postRunIdempotency(result, options);

      await safeCallHook<FlowCompleteEvent<TInput>>(
        this.config.hooks?.onFlowComplete,
        { flowName: this.name, input, context: ctx, result }
      )

      if (logger) {
        logger.onFlowComplete({ flowName: this.name, input, context: ctx, result });
      }

      return result;
    } catch (err) {
      await safeCallHook<FlowFailEvent<TInput>>(
        this.config.hooks?.onFlowFail,
        { flowName: this.name, input, context: ctx, result: err }
      )

      if (logger) {
        logger.onFlowFail({ flowName: this.name, input, context: ctx, result: err });
      }

      return {
        ...result,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: err
      };
    }
  }

  /**
   * Executes idempotency checks before starting the flow.
   */
  private async preRunIdempotency(input: TInput, options?: IdempotentRunOptions): Promise<FlowResult | null> {
    if (!options || !this.config.idempotency) return null;

    const idempotentResult = await this.handleIdempotency(input, options);

    if (idempotentResult.status === "cached") {
      return idempotentResult.value!;
    }

    if (idempotentResult.status === "running") {
      if (options.throwIfRunning) {
        throw new FlowAlreadyRunningError(this.name, options.key);
      }

      return {
        name: this.name,
        status: "running",
        durationMs: 0,
        steps: []
      };
    }

    return null;
  }

  /**
   * Finalizes the idempotency record after flow execution.
   */
  private async postRunIdempotency(result: FlowResult, options?: IdempotentRunOptions): Promise<void> {
    if (!options || !this.config.idempotency) return;

    if (result.status === 'completed') {
      if (options.cacheResult !== false) {
        await this.config.idempotency.complete(options.key, result);
      } else {
        await this.config.idempotency.delete(options.key);
      }
    } else if (result.status === 'failed') {
      await this.config.idempotency.fail(options.key, result.error);
    }
  }

  /**
   * Executes a single flow step, handling retries, timeout, and hooks.
   * 
   * @param step The step definition to execute.
   * @param ctx The current flow context.
   * @param manager The state manager to track step status.
   * @param input The initial flow input.
   * @returns The result of the step execution.
   */
  private async executeStep(
    step: Step<TInput>,
    ctx: FlowContext<TInput>,
    manager: State<TInput>,
    input: TInput,
    logger?: FlowLogger
  ): Promise<StepResult> {
    await safeCallHook<StepStartEvent<TInput>>(
      this.config.hooks?.onStepStart,
      { flowName: this.name, stepName: step.name, input, context: ctx }
    )

    if (logger) {
      logger.onStepStart({ flowName: this.name, stepName: step.name, input, context: ctx });
    }

    const startedAt = Date.now();
    let attempts = 0;

    manager.update(step, 'running');

    try {
      await runWithRetry(
        async () => {
          attempts++;
          const execution = step.fn(ctx);

          if (step.options?.timeoutMs) {
            return runWithTimeout(
              Promise.resolve(execution),
              step.options.timeoutMs
            );
          }

          return execution;
        },
        {
          retries: step.options?.retries ?? 0,
          retryDelayMs: step.options?.retryDelayMs ?? 0,
          backoffFactor: step.options?.backoffFactor,
          jitter: step.options?.jitter,
          maxRetryDelayMs: step.options?.maxRetryDelayMs,
          signal: ctx.signal,
        }
      );

      manager.update(step, 'completed');

      const result = {
        name: step.name,
        status: <StepStatus>'completed',
        attempts,
        durationMs: Date.now() - startedAt,
      }

      await safeCallHook<StepCompleteEvent<TInput>>(
        this.config.hooks?.onStepComplete,
        { flowName: this.name, stepName: step.name, input, context: ctx, result }
      )

      if (logger) {
        logger.onStepComplete({ flowName: this.name, stepName: step.name, input, context: ctx, result });
      }

      return result;
    } catch (error) {
      manager.update(step, 'failed');

      const result = {
        name: step.name,
        status: <StepStatus>'failed',
        attempts,
        durationMs: Date.now() - startedAt,
        error,
      }

      await safeCallHook<StepFailEvent<TInput>>(
        this.config.hooks?.onStepFail,
        { flowName: this.name, stepName: step.name, input, context: ctx, error: result }
      )

      if (logger) {
        logger.onStepFail({ flowName: this.name, stepName: step.name, input, context: ctx, error: result });
      }

      return result;
    }
  }

  /**
   * Executes multiple steps in parallel and collects their results.
   * 
   * @param steps List of steps to execute concurrently.
   * @param ctx The current flow context.
   * @param manager The state manager to track steps status.
   * @param input The initial flow input.
   * @param options Parallel execution options (e.g., fail-fast).
   * @returns List of results for each step in the parallel block.
   */
  private async executeParallelSteps(steps: Step<TInput>[], ctx: FlowContext<TInput>, manager: State<TInput>, input: TInput, options?: ParallelOptions, logger?: FlowLogger): Promise<StepResult[]> {
    const promises = steps.map(step => this.executeStep(step, ctx, manager, input, logger));
    const results: PromiseSettledResult<StepResult>[] = await Promise.allSettled(promises);
    
    return results.map(result => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      
      return {
        name: 'unknown',
        status: 'failed',
        attempts: 0,
        durationMs: 0,
        error: result.reason,
      };
    });
  }

  /**
   * Handles step failures, executing necessary compensations in reverse order.
   */
  private async handleStepFailure(
    error: unknown,
    ctx: FlowContext<TInput>,
    manager: State<TInput>,
    executedSteps: Step<TInput>[],
    input: TInput,
    logger?: FlowLogger
  ): Promise<void> {
    for (const executedStep of [...executedSteps].reverse()) {
      if (executedStep.options?.compensate && manager.get(executedStep.name)?.status === 'completed') {
        try {
          await safeCallHook<CompensateEvent<TInput>>(
            this.config.hooks?.onCompensate,
            {
              flowName: this.name,
              stepName: executedStep.name,
              input,
              context: ctx,
              error
            }
          )

          if (logger) {
            logger.onCompensate({
              flowName: this.name,
              stepName: executedStep.name,
              input,
              context: ctx,
              error
            });
          }

          await executedStep.options.compensate(ctx);
          manager.update(executedStep, 'cancelled');

          await safeCallHook<CompensateCompleteEvent<TInput>>(
            this.config.hooks?.onCompensateComplete,
            {
              flowName: this.name,
              stepName: executedStep.name,
              input,
              context: ctx,
              result: error
            }
          )
        } catch (compensationError) {
          // Compensation failed, but we do not interrupt the original error flow
        }
      }
    }
  }

  /**
   * Manages idempotency logic before actual execution.
   */
  private async handleIdempotency(
    input: TInput,
    options: IdempotentRunOptions
  ): Promise<IdempotentRunResult<FlowResult>> {
    const store = this.config.idempotency!;

    const existing = await store.get<FlowResult>(options.key);

    if (existing) {
      if (existing.status === "completed" && existing.data) {
        return {
          status: "cached",
          value: existing.data
        };
      }

      if (existing.status === "failed" && options.cacheResult !== false) {
        const errorResult: FlowResult = {
          name: this.name,
          status: "failed",
          durationMs: existing.updatedAt - existing.createdAt,
          steps: [],
          error: existing.error
        };

        return {
          status: "cached",
          value: errorResult
        };
      }

      if (existing.status === "running") {
        return {
          status: "running"
        };
      }
    }

    const startResult = await store.start(options.key, {
      ttlMs: options.ttlMs
    });

    if (!startResult.acquired) {
      return {
        status: "running"
      };
    }

    return {
      status: "executed"
    };
  }
}
