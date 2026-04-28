/**
 * Gerencia o estado compartilhado entre os passos de um fluxo.
 * @template TInput O tipo dos dados de entrada do fluxo.
 */
export class FlowContext<TInput> {
  private state: Map<string, unknown> = new Map<string, unknown>();

  /**
   * @param input Dados iniciais fornecidos ao fluxo.
   */
  constructor(public readonly input: TInput) {}

  /**
   * Obtém um valor do contexto.
   * @template TValue O tipo esperado do valor.
   * @param key A chave do valor.
   * @returns O valor associado à chave ou undefined.
   */
  get<TValue>(key: string): TValue | undefined {
    return this.state.get(key) as TValue | undefined;
  }

  /**
   * Define um valor no contexto.
   * @template TValue O tipo do valor.
   * @param key A chave onde o valor será armazenado.
   * @param value O valor a ser armazenado.
   */
  set<TValue>(key: string, value: TValue): void {
    this.state.set(key, value);
  }

  /**
   * Verifica se uma chave existe no contexto.
   * @param key A chave a ser verificada.
   * @returns Verdadeiro se a chave existir.
   */
  has(key: string): boolean {
    return this.state.has(key);
  }
}