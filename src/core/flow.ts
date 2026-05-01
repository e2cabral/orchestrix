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
import {FlowContext} from "./context";
import {runWithRetry} from "../utils/retry";
import {runWithTimeout} from "../utils/timeout";
import {State} from "./state";
import {StepAlreadyExistsError, FlowAlreadyRunningError} from "../errors";
import {safeCallHook} from "../utils/hooks";

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
   * @param idempotencyOptions Options for idempotent execution.
   * @returns Consolidated result of the flow execution.
   */
  async run(input: TInput, idempotencyOptions?: IdempotentRunOptions): Promise<FlowResult> {
    const flattenedNodes = this.nodes.flatMap(node => {
      if (node.type === 'parallel') {
        return node.steps;
      }
      return node.step;
    });

    const startedAt = Date.now();
    const ctx = new FlowContext(input);
    const manager = new State(flattenedNodes);
    const results: StepResult[] = [];
    const executedSteps: Step<TInput>[] = [];

    await safeCallHook<FlowStartEvent<TInput>>(
      this.config.hooks?.onFlowStart,
      { flowName: this.name, input, context: ctx }
    )

    const cached = await this.preRunIdempotency(input, idempotencyOptions);
    if (cached) return cached;

    let result: FlowResult = {
      name: this.name,
      status: "pending",
      durationMs: 0,
      steps: results
    };

    try {
      for (const node of this.nodes) {
        let stepResult: StepResult | undefined;
        let stepResults: StepResult[] = [];

        switch (node.type) {
          case "step":
            stepResult = await this.executeStep(node.step, ctx, manager, input);
            results.push(stepResult);
            break;
          case "parallel":
            stepResults = await this.executeParallelSteps(node.steps, ctx, manager, input, node.options);
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
              if (step.name !== stepResult.name && step.options?.compensate) {
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

                  await step.options.compensate(ctx);

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

          await this.handleStepFailure(stepResult.error, ctx, manager, executedSteps);

          result = {
            name: this.name,
            status: "failed",
            durationMs: Date.now() - startedAt,
            steps: results,
            error: stepResult.error
          };

          await this.postRunIdempotency(result, idempotencyOptions);
          return result;
        }

        executedSteps.push(...(node.type === 'step' ? [node.step] : node.steps));
      }

      result = {
        name: this.name,
        status: "completed",
        durationMs: Date.now() - startedAt,
        steps: results
      };

      await this.postRunIdempotency(result, idempotencyOptions);

      await safeCallHook<FlowCompleteEvent<TInput>>(
        this.config.hooks?.onFlowComplete,
        { flowName: this.name, input, context: ctx, result }
      )

      return result;
    } catch (err) {
      await safeCallHook<FlowFailEvent<TInput>>(
        this.config.hooks?.onFlowFail,
        { flowName: this.name, input, context: ctx, result: err }
      )

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
   * Executes a single flow step, handling retries and timeout.
   */
  private async executeStep(
    step: Step<TInput>,
    ctx: FlowContext<TInput>,
    manager: State<TInput>,
    input: TInput
  ): Promise<StepResult> {
    await safeCallHook<StepStartEvent<TInput>>(
      this.config.hooks?.onStepStart,
      { flowName: this.name, stepName: step.name, input, context: ctx }
    )

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

      return result;
    }
  }

  private async executeParallelSteps(steps: Step<TInput>[], ctx: FlowContext<TInput>, manager: State<TInput>, input: TInput, options?: ParallelOptions): Promise<StepResult[]> {
    const promises = steps.map(step => this.executeStep(step, ctx, manager, input));
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
    executedSteps: Step<TInput>[]
  ): Promise<void> {
    for (const executedStep of [...executedSteps].reverse()) {
      if (executedStep.options?.compensate) {
        try {
          await executedStep.options.compensate(ctx);
          manager.update(executedStep, 'cancelled');
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
