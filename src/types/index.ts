import {FlowContext} from "../core/context";

/**
 * Status possíveis de um fluxo de execução.
 */
export type FlowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Status possíveis de um passo (step) individual do fluxo.
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Opções de configuração para um passo do fluxo.
 */
export type StepOptions<TInput> = {
  /** Número máximo de tentativas em caso de falha. */
  retries?: number;
  /** Atraso em milissegundos entre as tentativas. */
  retryDelayMs?: number;
  /** Tempo máximo em milissegundos para a execução do passo. */
  timeoutMs?: number;
  /** Função de compensação executada caso o fluxo falhe em um passo posterior. */
  compensate?: (ctx: FlowContext<TInput>) => Promise<void> | void;
}

/**
 * Resultado da execução de um passo individual.
 */
export type StepResult = {
  /** Nome do passo. */
  name: string;
  /** Status final do passo. */
  status: StepStatus;
  /** Número de tentativas realizadas. */
  attempts: number;
  /** Duração da execução em milissegundos. */
  durationMs: number;
  /** Erro ocorrido, se houver. */
  error?: unknown;
}

/**
 * Resultado consolidado da execução de um fluxo.
 */
export type FlowResult = {
  /** Nome do fluxo. */
  name: string;
  /** Status final do fluxo. */
  status: FlowStatus;
  /** Duração total da execução em milissegundos. */
  durationMs: number;
  /** Lista de resultados de cada passo executado. */
  steps: StepResult[];
  /** Erro que causou a falha do fluxo, se houver. */
  error?: unknown;
}

/**
 * Representação interna de um passo do fluxo.
 */
export type Step<TInput> = {
  /** Nome único do passo. */
  name: string;
  /** Função de execução do passo. */
  fn: (ctx: FlowContext<TInput>) => Promise<void> | void;
  /** Opções específicas do passo. */
  options?: StepOptions<TInput>;
}

/**
 * Status possíveis para um registro de idempotência.
 */
export type IdempotencyStatus = 'running' | 'completed' | 'failed';

/**
 * Registro armazenado no sistema de idempotência.
 */
export type IdempotencyRecord<T = unknown> = {
  /** Chave única de idempotência. */
  key: string;
  /** Status atual da operação. */
  status: IdempotencyStatus;
  /** Timestamp de criação. */
  createdAt: number;
  /** Timestamp da última atualização. */
  updatedAt: number;
  /** Timestamp de expiração opcional. */
  expiresAt?: number;
  /** Dados de resultado armazenados. */
  data?: T;
  /** Erro armazenado caso a operação tenha falhado. */
  error?: unknown;
}

/**
 * Interface para implementações de armazenamento de idempotência.
 */
export type IdempotencyStore = {
  /** Obtém um registro pela chave. */
  get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null>;

  /** Inicia uma nova operação com a chave fornecida. */
  start(key: string, options?: {
    ttlMs?: number;
  }): Promise<{
    acquired: boolean;
    record: IdempotencyRecord;
  }>;

  /** Marca a operação como concluída com sucesso. */
  complete<T = unknown>(key: string, result: T): Promise<void>;

  /** Marca a operação como falha. */
  fail(key: string, error: unknown): Promise<void>;

  /** Remove um registro de idempotência. */
  delete(key: string): Promise<void>;

  /** Limpa registros expirados. */
  cleanup(): Promise<void>;
}

/**
 * Opções para execução idempotente de um fluxo.
 */
export type IdempotentRunOptions = {
  /** Chave única para identificar esta execução. */
  key: string;
  /** Tempo de vida do registro em milissegundos. */
  ttlMs?: number;
  /** Se deve fazer cache do resultado (padrão: true). */
  cacheResult?: boolean;
  /** Se deve lançar erro caso a operação já esteja em execução (padrão: false). */
  throwIfRunning?: boolean;
};

/**
 * Resultado de uma tentativa de execução idempotente.
 */
export type IdempotentRunResult<T> = {
  /** Status da execução: executada agora, retornada do cache ou já em execução. */
  status: "executed" | "cached" | "running";
  /** Valor retornado, se disponível (cacheado ou executado). */
  value?: T;
};

/**
 * Configuração global do fluxo.
 */
export type FlowConfig = {
  /** Implementação do armazenamento de idempotência. */
  idempotency?: IdempotencyStore;
};