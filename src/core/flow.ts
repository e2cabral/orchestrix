import {
  FlowConfig,
  FlowResult,
  Step,
  StepOptions,
  StepResult,
  IdempotentRunOptions,
  IdempotentRunResult
} from "../types";
import {FlowContext} from "./context";
import {runWithRetry} from "../utils/retry";
import {runWithTimeout} from "../utils/timeout";
import {State} from "./state";
import {StepAlreadyExistsError, FlowAlreadyRunningError} from "../errors";

/**
 * Main class for defining and executing workflows.
 * @template TInput The type of the flow input data.
 */
export class Flow<TInput = unknown> {
  private steps: Step<TInput>[] = [];

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
    if (this.steps.some(step => step.name === name)) {
      throw new StepAlreadyExistsError(name);
    }
    this.steps.push({name, fn, options});
    return this;
  }

  /**
   * Runs the flow with the provided data.
   * @param input Input data for the flow.
   * @param idempotencyOptions Options for idempotent execution.
   * @returns Consolidated result of the flow execution.
   */
  async run(input: TInput, idempotencyOptions?: IdempotentRunOptions): Promise<FlowResult> {
    const cached = await this.preRunIdempotency(input, idempotencyOptions);
    if (cached) return cached;

    const startedAt = Date.now();
    const ctx = new FlowContext(input);
    const manager = new State(this.steps);
    const results: StepResult[] = [];
    const executedSteps: Step<TInput>[] = [];

    let result: FlowResult = {
      name: this.name,
      status: "pending",
      durationMs: 0,
      steps: results
    };

    try {
      for (const step of this.steps) {
        const stepResult = await this.executeStep(step, ctx, manager);
        results.push(stepResult);

        if (stepResult.status === 'failed') {
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

        executedSteps.push(step);
      }

      result = {
        name: this.name,
        status: "completed",
        durationMs: Date.now() - startedAt,
        steps: results
      };

      await this.postRunIdempotency(result, idempotencyOptions);
      return result;
    } catch (err) {
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
    manager: State<TInput>
  ): Promise<StepResult> {
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
        }
      );

      manager.update(step, 'completed');
      return {
        name: step.name,
        status: 'completed',
        attempts,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      manager.update(step, 'failed');
      return {
        name: step.name,
        status: 'failed',
        attempts,
        durationMs: Date.now() - startedAt,
        error,
      };
    }
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