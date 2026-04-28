export class LocalFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalFlowError';
  }
}

export class StepAlreadyExistsError extends LocalFlowError {
  constructor(stepName: string) {
    super(`Step with name '${stepName}' already exists`);
    this.name = 'StepAlreadyExistsError';
  }
}

export class FlowAlreadyRunningError extends LocalFlowError {
  constructor(flowName: string, key: string) {
    super(`Flow '${flowName}' is already running with key '${key}'`);
    this.name = 'FlowAlreadyRunningError';
  }
}

export class IdempotencyRecordNotFoundError extends LocalFlowError {
  constructor(key: string) {
    super(`Record not found for key: ${key}`);
    this.name = 'IdempotencyRecordNotFoundError';
  }
}

export class StepTimeoutError extends LocalFlowError {
  constructor(stepName: string, timeoutMs: number) {
    super(`Step '${stepName}' timed out after ${timeoutMs}ms`);
    this.name = 'StepTimeoutError';
  }
}
