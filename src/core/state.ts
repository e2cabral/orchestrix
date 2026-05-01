import {Step, StepStatus} from "../types";

/**
 * Manages the internal execution state of flow steps.
 * @template TInput The type of the flow input data.
 */
export class State<TInput> {
  private manager: Map<string, StepStatus> = new Map<string, StepStatus>();

  /**
   * @param steps List of flow steps to initialize the state.
   */
  constructor(steps: Step<TInput>[]) {
    steps.forEach(step => {
      this.manager.set(step.name, 'pending');
    });
  }

  /**
   * Updates the status of a step.
   * @param step The step to be updated.
   * @param status The new status.
   */
  update(step: Step<TInput>, status: StepStatus): void {
    this.manager.set(step.name, status);
  }

  /**
   * Gets the current status of a step.
   * @param step The desired step.
   * @returns The current status.
   */
  getStatus(step: Step<TInput>): StepStatus {
    return this.manager.get(step.name) ?? 'pending';
  }
}
