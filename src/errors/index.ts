export class OrchestrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrixError';
  }
}

export class StepAlreadyExistsError extends OrchestrixError {
  constructor(stepName: string) {
    super(`Step with name '${stepName}' already exists`);
    this.name = 'StepAlreadyExistsError';
  }
}

export class FlowAlreadyRunningError extends OrchestrixError {
  constructor(flowName: string, key: string) {
    super(`Flow '${flowName}' is already running with key '${key}'`);
    this.name = 'FlowAlreadyRunningError';
  }
}

export class IdempotencyRecordNotFoundError extends OrchestrixError {
  constructor(key: string) {
    super(`Record not found for key: ${key}`);
    this.name = 'IdempotencyRecordNotFoundError';
  }
}

export class StepTimeoutError extends OrchestrixError {
  constructor(stepName: string, timeoutMs: number) {
    super(`Step '${stepName}' timed out after ${timeoutMs}ms`);
    this.name = 'StepTimeoutError';
  }
}
