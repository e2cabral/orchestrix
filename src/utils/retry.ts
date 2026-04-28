/**
 * Opções para a lógica de re-tentativa.
 */
type RetryOptions = {
  /** Número máximo de tentativas. */
  retries: number;
  /** Atraso entre as tentativas em milissegundos. */
  retryDelayMs: number;
};

/**
 * Executa uma função com lógica de re-tentativa em caso de falha.
 * @template T O tipo do retorno da função.
 * @param fn A função a ser executada.
 * @param options Configurações de retry.
 * @returns O resultado da função se bem-sucedida.
 * @throws O último erro ocorrido se todas as tentativas falharem.
 */
export async function runWithRetry<T>(
  fn: () => Promise<T> | T,
  options: RetryOptions
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < options.retries && options.retryDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.retryDelayMs)
        );
      }
    }
  }

  throw lastError;
}