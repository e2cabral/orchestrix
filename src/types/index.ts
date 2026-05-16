import {FlowContext} from "../core/context";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {Flow} from "../core/flow";

/**
 * Possible statuses of an execution flow.
 */
export type FlowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Possible statuses of an individual flow step.
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Configuration options for a flow step.
 */
export type StepOptions<TInput> = {
  /** Maximum number of retry attempts in case of failure. */
  retries?: number;
  /** Delay in milliseconds between retry attempts. */
  retryDelayMs?: number;
  /** Maximum time in milliseconds for the step execution. */
  timeoutMs?: number;

  /**
   * The backoff strategy to use.
   * 'fixed': Fixed delay.
   * 'linear': Linear increase (retryDelayMs * attempt).
   * 'exponential': Exponential increase (retryDelayMs * 2^attempt).
   */
  backoffFactor?: 'fixed' | 'linear' | 'exponential';
  /** Adds a random variation to the retry delay to avoid synchronized retries. */
  jitter?: boolean;
  /** Maximum delay between retries in milliseconds. */
  maxRetryDelayMs?: number;
  /** Compensation function executed if the flow fails in a subsequent step. */
  compensate?: (ctx: FlowContext<TInput>) => Promise<void> | void;
}

/**
 * Result of an individual step execution.
 */
export type StepResult = {
  /** Step name. */
  name: string;
  /** Final step status. */
  status: StepStatus;
  /** Number of attempts made. */
  attempts: number;
  /** Execution duration in milliseconds. */
  durationMs: number;
  /** Error occurred, if any. */
  error?: unknown;
}

/**
 * Consolidated result of a flow execution.
 */
export type FlowResult = {
  /** Flow name. */
  name: string;
  /** Final flow status. */
  status: FlowStatus;
  /** Total execution duration in milliseconds. */
  durationMs: number;
  /** List of results for each executed step. */
  steps: StepResult[];
  /** Error that caused the flow failure, if any. */
  error?: unknown;
}

/**
 * Internal representation of a flow step.
 */
export type Step<TInput> = {
  /** Unique step name. */
  name: string;
  /** Step execution function. */
  fn: (ctx: FlowContext<TInput>) => Promise<void> | void;
  /** Specific step options. */
  options?: StepOptions<TInput>;
}

export type FlowNode<TInput> =
  | { type: 'step', step: Step<TInput> }
  | { type: 'parallel', steps: Step<TInput>[], options?: ParallelOptions };

export type ParallelOptions = {
  failFast?: boolean;
};

/**
 * Possible statuses for an idempotency record.
 */
export type IdempotencyStatus = 'running' | 'completed' | 'failed';

/**
 * Record stored in the idempotency system.
 */
export type IdempotencyRecord<T = unknown> = {
  /** Unique idempotency key. */
  key: string;
  /** Current operation status. */
  status: IdempotencyStatus;
  /** Creation timestamp. */
  createdAt: number;
  /** Last update timestamp. */
  updatedAt: number;
  /** Optional expiration timestamp. */
  expiresAt?: number;
  /** Stored result data. */
  data?: T;
  /** Stored error if the operation failed. */
  error?: unknown;
}

/**
 * Interface for idempotency store implementations.
 */
export type IdempotencyStore = {
  /** Gets a record by key. */
  get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null>;

  /** Starts a new operation with the given key. */
  start(key: string, options?: {
    ttlMs?: number;
  }): Promise<{
    acquired: boolean;
    record: IdempotencyRecord;
  }>;

  /** Marks the operation as successfully completed. */
  complete<T = unknown>(key: string, result: T): Promise<void>;

  /** Marks the operation as failed. */
  fail(key: string, error: unknown): Promise<void>;

  /** Removes an idempotency record. */
  delete(key: string): Promise<void>;

  /** Cleans up expired records. */
  cleanup(): Promise<void>;
}

/**
 * Options for idempotent flow execution.
 */
export type IdempotentRunOptions = {
  /** Unique key to identify this execution. */
  key: string;
  /** Record time-to-live in milliseconds. */
  ttlMs?: number;
  /** Whether to cache the result (default: true). */
  cacheResult?: boolean;
  /** Whether to throw an error if the operation is already running (default: false). */
  throwIfRunning?: boolean;
};

/**
 * Result of an idempotent execution attempt.
 */
export type IdempotentRunResult<T> = {
  /** Execution status: executed now, returned from cache, or already running. */
  status: "executed" | "cached" | "running";
  /** Returned value, if available (cached or executed). */
  value?: T;
};

/**
 * Global flow configuration.
 */
export type FlowConfig<TInput = unknown> = {
  /** Idempotency store implementation. */
  idempotency?: IdempotencyStore;
  hooks?: FlowHooks<any>;
  schema?: StandardSchemaV1<TInput>;
};


export type FlowHooks<TInput> = {
  onFlowStart?: (event: FlowStartEvent<TInput>) => void | Promise<void>;
  onFlowComplete?: (event: FlowCompleteEvent<TInput>) => void | Promise<void>;
  onFlowFail?: (event: FlowFailEvent<TInput>) => void | Promise<void>;

  onStepStart?: (event: StepStartEvent<TInput>) => void | Promise<void>;
  onStepComplete?: (event: StepCompleteEvent<TInput>) => void | Promise<void>;
  onStepFail?: (event: StepFailEvent<TInput>) => void | Promise<void>;

  onCompensate?: (event: CompensateEvent<TInput>) => void | Promise<void>;
  onCompensateComplete?: (event: CompensateCompleteEvent<TInput>) => void | Promise<void>;
}

export type StepStartEvent<TInput> = {
  flowName: string;
  stepName: string;
  input: TInput;
  context: FlowContext<TInput>;
};

export type StepCompleteEvent<TInput> = {
  flowName: string;
  stepName: string;
  input: TInput;
  context: FlowContext<TInput>;
  result: unknown;
};

export type StepFailEvent<TInput> = {
  flowName: string;
  stepName: string;
  input: TInput;
  context: FlowContext<TInput>;
  error: unknown;
};

export type CompensateCompleteEvent<TInput> = {
  flowName: string;
  stepName: string;
  input: TInput;
  context: FlowContext<TInput>;
  result: unknown;
};

export type CompensateEvent<TInput> = {
  flowName: string;
  stepName: string;
  input: TInput;
  context: FlowContext<TInput>;
  error: unknown;
};

export type FlowCompleteEvent<TInput> = {
  flowName: string;
  input: TInput;
  context: FlowContext<TInput>;
  result: unknown;
};

export type FlowStartEvent<TInput> = {
  flowName: string;
  input: TInput;
  context: FlowContext<TInput>;
};

export type FlowFailEvent<TInput> = {
  flowName: string;
  input: TInput;
  context: FlowContext<TInput>;
  result: unknown;
};

export type FlowHookEvent<TInput> =
  | StepStartEvent<TInput>
  | StepCompleteEvent<TInput>
  | StepFailEvent<TInput>
  | CompensateEvent<TInput>
  | CompensateCompleteEvent<TInput>
  | FlowStartEvent<TInput>
  | FlowCompleteEvent<TInput>
  | FlowFailEvent<TInput>;

export type FlowHookCallable<TInput> = (event: FlowHookEvent<TInput>) => Promise<void> | void;
