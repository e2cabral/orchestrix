/**
 * Executa uma promise com um tempo limite.
 * @template T O tipo do retorno da promise.
 * @param promise A promise a ser executada.
 * @param timeoutMs Tempo limite em milissegundos.
 * @returns O resultado da promise original.
 * @throws Erro de timeout se o tempo for excedido.
 */
export function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Step timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}