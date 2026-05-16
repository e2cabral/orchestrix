import { AsyncLocalStorage } from 'node:async_hooks';

export interface StepInfo {
  flowName: string;
  stepName: string;
}

export const stepStorage = new AsyncLocalStorage<StepInfo>();
