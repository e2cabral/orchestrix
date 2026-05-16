/**
 * Manages the shared state between flow steps.
 * @template TInput The type of the flow input data.
 */
export class FlowContext<TInput> {
  private state: Map<string, unknown> = new Map<string, unknown>();

  /**
   * @param input Initial data provided to the flow.
   * @param signal {AbortSignal} Optional signal to cancel the flow execution.
   */
  constructor(public readonly input: TInput, public readonly signal?: AbortSignal) {}

  /**
   * Gets a value from the context.
   * @template TValue The expected type of the value.
   * @param key The value key.
   * @returns The value associated with the key or undefined.
   */
  get<TValue>(key: string): TValue | undefined {
    return this.state.get(key) as TValue | undefined;
  }

  /**
   * Sets a value in the context.
   * @template TValue The type of the value.
   * @param key The key where the value will be stored.
   * @param value The value to be stored.
   */
  set<TValue>(key: string, value: TValue): void {
    this.state.set(key, value);
  }

  /**
   * Checks if a key exists in the context.
   * @param key The key to check.
   * @returns True if the key exists.
   */
  has(key: string): boolean {
    return this.state.has(key);
  }
}
