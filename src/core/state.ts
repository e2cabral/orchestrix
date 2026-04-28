import {Step, StepStatus} from "../types";

/**
 * Gerencia o estado interno de execução dos passos de um fluxo.
 * @template TInput O tipo dos dados de entrada do fluxo.
 */
export class State<TInput> {
  private manager: Map<string, StepStatus> = new Map<string, StepStatus>();

  /**
   * @param steps Lista de passos do fluxo para inicializar o estado.
   */
  constructor(steps: Step<TInput>[]) {
    steps.forEach(step => {
      this.manager.set(step.name, 'pending');
    });
  }

  /**
   * Atualiza o status de um passo.
   * @param step O passo a ser atualizado.
   * @param status O novo status.
   */
  update(step: Step<TInput>, status: StepStatus): void {
    this.manager.set(step.name, status);
  }

  /**
   * Obtém o status atual de um passo.
   * @param step O passo desejado.
   * @returns O status atual.
   */
  getStatus(step: Step<TInput>): StepStatus {
    return this.manager.get(step.name) ?? 'pending';
  }
}