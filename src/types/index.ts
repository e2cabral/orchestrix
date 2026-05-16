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

/**
 * Internal representation of a node in the flow graph (either a single step or a parallel block).
 */
export type FlowNode<TInput> =
  | { type: 'step', step: Step<TInput> }
  | { type: 'parallel', steps: Step<TInput>[], options?: ParallelOptions };

/**
 * Options for parallel step execution.
 */
export type ParallelOptions = {
  /** If true, the first step failure will cause the entire parallel block to fail immediately. */
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
  /** Idempotency store implementation to avoid duplicate executions. */
  idempotency?: IdempotencyStore;
  /** Hooks to observe flow and step execution events. */
  hooks?: FlowHooks<any>;
  /** Schema to validate flow input using Standard Schema v1 protocol. */
  schema?: StandardSchemaV1<TInput>;
};

/**
 * Collection of hooks that can be used to observe the lifecycle of a flow.
 */
export type FlowHooks<TInput> = {
  /** Called when the flow starts. */
  onFlowStart?: (event: FlowStartEvent<TInput>) => void | Promise<void>;
  /** Called when the flow completes successfully. */
  onFlowComplete?: (event: FlowCompleteEvent<TInput>) => void | Promise<void>;
  /** Called when the flow fails. */
  onFlowFail?: (event: FlowFailEvent<TInput>) => void | Promise<void>;

  /** Called when a step starts. */
  onStepStart?: (event: StepStartEvent<TInput>) => void | Promise<void>;
  /** Called when a step completes successfully. */
  onStepComplete?: (event: StepCompleteEvent<TInput>) => void | Promise<void>;
  /** Called when a step fails. */
  onStepFail?: (event: StepFailEvent<TInput>) => void | Promise<void>;

  /** Called when a compensation starts. */
  onCompensate?: (event: CompensateEvent<TInput>) => void | Promise<void>;
  /** Called when a compensation completes. */
  onCompensateComplete?: (event: CompensateCompleteEvent<TInput>) => void | Promise<void>;
}

/**
 * Event payload for when a step starts.
 */
export type StepStartEvent<TInput> = {
  /** The name of the flow. */
  flowName: string;
  /** The name of the step. */
  stepName: string;
  /** The initial input of the flow. */
  input: TInput;
  /** The current flow context. */
  context: FlowContext<TInput>;
};

/**
 * Event payload for when a step completes.
 */
export type StepCompleteEvent<TInput> = {
  /** The name of the flow. */
  flowName: string;
  /** The name of the step. */
  stepName: string;
  /** The initial input of the flow. */
  input: TInput;
  /** The current flow context. */
  context: FlowContext<TInput>;
  /** The value returned by the step function. */
  result: unknown;
};

/**
 * Event payload for when a step fails.
 */
export type StepFailEvent<TInput> = {
  /** The name of the flow. */
  flowName: string;
  /** The name of the step. */
  stepName: string;
  /** The initial input of the flow. */
  input: TInput;
  /** The current flow context. */
  context: FlowContext<TInput>;
  /** The error that caused the failure. */
  error: unknown;
};

/**
 * Event payload for when a compensation completes.
 */
export type CompensateCompleteEvent<TInput> = {
  /** The name of the flow. */
  flowName: string;
  /** The name of the step. */
  stepName: string;
  /** The initial input of the flow. */
  input: TInput;
  /** The current flow context. */
  context: FlowContext<TInput>;
  /** The value returned by the compensation function. */
  result: unknown;
};

/**
 * Event payload for when a compensation is triggered.
 */
export type CompensateEvent<TInput> = {
  /** The name of the flow. */
  flowName: string;
  /** The name of the step. */
  stepName: string;
  /** The initial input of the flow. */
  input: TInput;
  /** The current flow context. */
  context: FlowContext<TInput>;
  /** The error that triggered the compensation. */
  error: unknown;
};

/**
 * Event payload for when a flow completes.
 */
export type FlowCompleteEvent<TInput> = {
  /** The name of the flow. */
  flowName: string;
  /** The initial input of the flow. */
  input: TInput;
  /** The current flow context. */
  context: FlowContext<TInput>;
  /** The consolidated result of the flow. */
  result: unknown;
};

/**
 * Event payload for when a flow starts.
 */
export type FlowStartEvent<TInput> = {
  /** The name of the flow. */
  flowName: string;
  /** The initial input of the flow. */
  input: TInput;
  /** The current flow context. */
  context: FlowContext<TInput>;
};

/**
 * Event payload for when a flow fails.
 */
export type FlowFailEvent<TInput> = {
  /** The name of the flow. */
  flowName: string;
  /** The initial input of the flow. */
  input: TInput;
  /** The current flow context. */
  context: FlowContext<TInput>;
  /** The error or result that caused the failure. */
  result: unknown;
};

/**
 * Union type of all possible flow hook events.
 */
export type FlowHookEvent<TInput> =
  | StepStartEvent<TInput>
  | StepCompleteEvent<TInput>
  | StepFailEvent<TInput>
  | CompensateEvent<TInput>
  | CompensateCompleteEvent<TInput>
  | FlowStartEvent<TInput>
  | FlowCompleteEvent<TInput>
  | FlowFailEvent<TInput>;

/**
 * Type for a callable hook function.
 */
export type FlowHookCallable<TInput> = (event: FlowHookEvent<TInput>) => Promise<void> | void;
