/**
 * Base error class for all Orchestrix-related errors.
 */
export class OrchestrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrixError';
  }
}

/**
 * Thrown when attempting to add a step with a name that already exists in the flow.
 */
export class StepAlreadyExistsError extends OrchestrixError {
  constructor(stepName: string) {
    super(`Step with name '${stepName}' already exists`);
    this.name = 'StepAlreadyExistsError';
  }
}

/**
 * Thrown when attempting to run a flow that is already in progress with the same idempotency key.
 */
export class FlowAlreadyRunningError extends OrchestrixError {
  constructor(flowName: string, key: string) {
    super(`Flow '${flowName}' is already running with key '${key}'`);
    this.name = 'FlowAlreadyRunningError';
  }
}

/**
 * Thrown when an expected idempotency record is not found in the store.
 */
export class IdempotencyRecordNotFoundError extends OrchestrixError {
  constructor(key: string) {
    super(`Record not found for key: ${key}`);
    this.name = 'IdempotencyRecordNotFoundError';
  }
}

/**
 * Thrown when a step execution exceeds its defined timeout.
 */
export class StepTimeoutError extends OrchestrixError {
  constructor(stepName: string, timeoutMs: number) {
    super(`Step '${stepName}' timed out after ${timeoutMs}ms`);
    this.name = 'StepTimeoutError';
  }
}

/**
 * Thrown when flow input validation fails against the provided schema.
 */
export class FlowValidationError extends OrchestrixError {
  /**
   * @param issues List of validation issues from the schema provider.
   */
  constructor(public readonly issues: unknown[]) {
    super('Flow input validation failed');
    this.name = 'FlowValidationError';
  }
}