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
  StepStartEvent, StepCompleteEvent, StepStatus, StepFailEvent, FlowHooks, FlowPlugin
} from "../types";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {FlowContext} from "./context";
import {runWithRetry} from "../utils/retry";
import {runWithTimeout} from "../utils/timeout";
import {State} from "./state";
import {FlowAlreadyRunningError, FlowValidationError, StepAlreadyExistsError} from "../errors";
import {safeCallHook} from "../utils/hooks";
import {FlowLogger} from "../utils/logger";
import {stepStorage} from "../utils/storage";

/**
 * Main class for defining and executing workflows.
 * @template TInput The type of the flow input data.
 */
export class Flow<TInput = unknown> {
  private nodes: FlowNode<TInput>[] = [];
  private plugins: FlowPlugin<TInput>[] = [];

  /**
   * @param name Flow name.
   * @param config Optional flow configurations.
   */
  constructor(
    public readonly name: string,
    public readonly config: FlowConfig<TInput> = {}
  ) {
    this.initPlugins();
  }

  /**
   * Initializes plugins and built-in logger if enabled.
   */
  private initPlugins(): void {
    if (this.config.logging) {
      const logOptions = typeof this.config.logging === "boolean"
        ? { enabled: this.config.logging }
        : this.config.logging;
      this.plugins.push(new FlowLogger(logOptions));
    }

    if (this.config.plugins) {
      this.plugins.push(...this.config.plugins);
    }
  }

  /**
   * Ensures that a step name is unique within the flow.
   * @throws {StepAlreadyExistsError} If the name is already in use.
   */
  private ensureUniqueStepName(name: string): void {
    const exists = this.nodes.some(node => {
      if (node.type === 'step') return node.step.name === name;
      return node.steps.some(s => s.name === name);
    });

    if (exists) {
      throw new StepAlreadyExistsError(name);
    }
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
    this.ensureUniqueStepName(name);
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
    this.ensureUniqueStepName(name);
    this.nodes.push({type: 'parallel', steps, options});
    return this;
  }

  /**
   * Validates flow input using the provided schema.
   */
  private async validateInput(input: TInput): Promise<FlowValidationError | null> {
    if (!this.config.schema) return null;
    const result = await this.config.schema['~standard'].validate(input);
    return result.issues ? new FlowValidationError(result.issues as unknown[]) : null;
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
    const ctx = new FlowContext(input, signal);

    // 1. Validation
    const validationError = await this.validateInput(input);
    if (validationError) {
      const errorResult: FlowResult = {
        name: this.name,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        steps: [],
        error: validationError
      };
      await this.emit('onFlowFail', { flowName: this.name, input, context: ctx, result: validationError });
      return errorResult;
    }

    // 2. Setup
    const flattenedNodes = this.nodes.flatMap(node => node.type === 'parallel' ? node.steps : node.step);
    const manager = new State(flattenedNodes);
    const results: StepResult[] = [];
    const executedSteps: Step<TInput>[] = [];

    // 3. Idempotency Check
    const cached = await this.preRunIdempotency(input, options);
    if (cached) return cached;

    await this.emit('onFlowStart', { flowName: this.name, input, context: ctx });

    let finalResult: FlowResult | null = null;

    try {
      for (const node of this.nodes) {
        // Check for cancellation before each step
        if (signal?.aborted) {
          finalResult = await this.handleCancellation(signal.reason, ctx, manager, executedSteps, input, results, startedAt);
          break;
        }

        let stepResult: StepResult | undefined;
        let stepResults: StepResult[] = [];

        if (node.type === 'step') {
          stepResult = await this.executeStep(node.step, ctx, manager, input);
          results.push(stepResult);
        } else {
          stepResults = await this.executeParallelSteps(node.steps, ctx, manager, input, node.options);
          results.push(...stepResults);
          
          const failedSteps = stepResults.filter(s => s.status === 'failed');
          if (node.options?.failFast) {
            stepResult = failedSteps.length > 0 ? failedSteps[0] : undefined;
          } else {
            stepResult = failedSteps.length === node.steps.length ? failedSteps[0] : undefined;
          }
        }

        if (stepResult?.status === 'failed') {
          const currentSuccessfulSteps = node.type === 'parallel'
            ? node.steps.filter(s => manager.get(s.name).status === 'completed')
            : [];
          
          finalResult = await this.handleFailure(
            stepResult.error, 
            ctx, 
            manager, 
            [...executedSteps, ...currentSuccessfulSteps], 
            input, 
            results, 
            startedAt, 
            options
          );
          break;
        }

        executedSteps.push(...(node.type === 'step' ? [node.step] : node.steps));
      }

      // Final check for cancellation
      if (!finalResult && signal?.aborted) {
        finalResult = await this.handleCancellation(signal.reason, ctx, manager, executedSteps, input, results, startedAt);
      }

      // Success
      if (!finalResult) {
        finalResult = {
          name: this.name,
          status: "completed",
          durationMs: Date.now() - startedAt,
          steps: results
        };
        await this.postRunIdempotency(finalResult, options);
        await this.emit('onFlowComplete', { flowName: this.name, input, context: ctx, result: finalResult });
      }

      return finalResult;
    } catch (err) {
      await this.emit('onFlowFail', { flowName: this.name, input, context: ctx, result: err });
      return {
        name: this.name,
        status: "failed",
        durationMs: Date.now() - startedAt,
        steps: results,
        error: err
      };
    }
  }

  /**
   * Handles flow cancellation.
   */
  private async handleCancellation(
    reason: unknown,
    ctx: FlowContext<TInput>,
    manager: State<TInput>,
    executedSteps: Step<TInput>[],
    input: TInput,
    results: StepResult[],
    startedAt: number
  ): Promise<FlowResult> {
    await this.handleCompensations(reason, ctx, manager, executedSteps, input);
    const result: FlowResult = {
      name: this.name,
      status: "cancelled",
      durationMs: Date.now() - startedAt,
      steps: results,
      error: reason
    };
    await this.emit('onFlowComplete', { flowName: this.name, input, context: ctx, result });
    return result;
  }

  /**
   * Handles step failure.
   */
  private async handleFailure(
    error: unknown,
    ctx: FlowContext<TInput>,
    manager: State<TInput>,
    executedSteps: Step<TInput>[],
    input: TInput,
    results: StepResult[],
    startedAt: number,
    options?: IdempotentRunOptions
  ): Promise<FlowResult> {
    await this.handleCompensations(error, ctx, manager, executedSteps, input);
    const result: FlowResult = {
      name: this.name,
      status: "failed",
      durationMs: Date.now() - startedAt,
      steps: results,
      error
    };
    await this.postRunIdempotency(result, options);
    await this.emit('onFlowFail', { flowName: this.name, input, context: ctx, result: error });
    return result;
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
    input: TInput
  ): Promise<StepResult> {
    await this.emit('onStepStart', { flowName: this.name, stepName: step.name, input, context: ctx });

    const startedAt = Date.now();
    let attempts = 0;

    manager.update(step, 'running');

    try {
      await stepStorage.run({ flowName: this.name, stepName: step.name }, () => 
        runWithRetry(
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
        )
      );

      manager.update(step, 'completed');

      const result = {
        name: step.name,
        status: <StepStatus>'completed',
        attempts,
        durationMs: Date.now() - startedAt,
      }

      await this.emit('onStepComplete', { flowName: this.name, stepName: step.name, input, context: ctx, result });

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

      await this.emit('onStepFail', { flowName: this.name, stepName: step.name, input, context: ctx, error: result });

      return result;
    }
  }

  /**
   * Executes multiple steps in parallel and collects their results.
   */
  private async executeParallelSteps(
    steps: Step<TInput>[],
    ctx: FlowContext<TInput>,
    manager: State<TInput>,
    input: TInput,
    options?: ParallelOptions
  ): Promise<StepResult[]> {
    const promises = steps.map(step => this.executeStep(step, ctx, manager, input));
    const results = await Promise.all(promises);
    return results;
  }

  /**
   * Handles step compensations in reverse order of execution.
   */
  private async handleCompensations(
    error: unknown,
    ctx: FlowContext<TInput>,
    manager: State<TInput>,
    executedSteps: Step<TInput>[],
    input: TInput
  ): Promise<void> {
    for (const step of [...executedSteps].reverse()) {
      if (step.options?.compensate && manager.get(step.name)?.status === 'completed') {
        try {
          await this.emit('onCompensate', {
            flowName: this.name,
            stepName: step.name,
            input,
            context: ctx,
            error
          });

          await step.options.compensate(ctx);
          manager.update(step, 'cancelled');

          await this.emit('onCompensateComplete', {
            flowName: this.name,
            stepName: step.name,
            input,
            context: ctx,
            result: error
          });
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

  /**
   * Emits a lifecycle event to both global hooks and registered plugins.
   */
  private async emit<K extends keyof FlowHooks<TInput>>(
    hookName: K,
    event: Parameters<NonNullable<FlowHooks<TInput>[K]>>[0]
  ): Promise<void> {
    // Call global hook
    if (this.config.hooks && this.config.hooks[hookName]) {
      await safeCallHook(this.config.hooks[hookName] as any, event);
    }

    // Call plugin hooks
    if (this.plugins.length > 0) {
      for (const plugin of this.plugins) {
        const hook = plugin[hookName];
        if (typeof hook === 'function') {
          await safeCallHook(hook.bind(plugin) as any, event);
        }
      }
    }
  }
}
