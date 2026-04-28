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
 * Classe principal para definição e execução de fluxos de trabalho (workflows).
 * @template TInput O tipo dos dados de entrada do fluxo.
 */
export class Flow<TInput = unknown> {
  private steps: Step<TInput>[] = [];

  /**
   * @param name Nome do fluxo.
   * @param config Configurações opcionais do fluxo.
   */
  constructor(
    public readonly name: string,
    public readonly config: FlowConfig = {}
  ) {
  }

  /**
   * Adiciona um novo passo ao fluxo.
   * @param name Nome único do passo.
   * @param fn Função a ser executada neste passo.
   * @param options Opções de configuração do passo (retry, timeout, compensação).
   * @returns A própria instância do Flow para encadeamento.
   * @throws Erro se já existir um passo com o mesmo nome.
   */
  step(name: string, fn: Step<TInput>['fn'], options?: StepOptions<TInput>): this {
    if (this.steps.some(step => step.name === name)) {
      throw new StepAlreadyExistsError(name);
    }
    this.steps.push({name, fn, options});
    return this;
  }

  /**
   * Executa o fluxo com os dados fornecidos.
   * @param input Dados de entrada para o fluxo.
   * @param idempotencyOptions Opções para execução idempotente.
   * @returns Resultado consolidado da execução do fluxo.
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
   * Executa as verificações de idempotência antes de iniciar o fluxo.
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
   * Finaliza o registro de idempotência após a execução do fluxo.
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
   * Executa um único passo do fluxo, tratando retries e timeout.
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
   * Trata falhas em passos, executando as compensações necessárias em ordem reversa.
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
          // Compensação falhou, mas não interrompemos o fluxo de erro original
        }
      }
    }
  }

  /**
   * Gerencia a lógica de idempotência antes da execução real.
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