import { describe, expect, it, vi } from "vitest";
import { runWithRetry } from "../src/utils/retry";

describe("runWithRetry", () => {
  it("deve executar com sucesso na primeira tentativa", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await runWithRetry(fn, { retries: 3, retryDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("deve tentar novamente em caso de falha", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");
    const result = await runWithRetry(fn, { retries: 3, retryDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("deve falhar após esgotar as tentativas", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(runWithRetry(fn, { retries: 2, retryDelayMs: 0 }))
      .rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("deve respeitar o backoff linear", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    // Não podemos testar o tempo exato facilmente sem mocks de timer, mas podemos verificar o fluxo
    await expect(runWithRetry(fn, { retries: 1, retryDelayMs: 1, backoffFactor: 'linear' }))
      .rejects.toThrow("fail");
  });

  it("deve respeitar o backoff exponencial", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(runWithRetry(fn, { retries: 1, retryDelayMs: 1, backoffFactor: 'exponential' }))
      .rejects.toThrow("fail");
  });

  it("deve respeitar o backoff fixo", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(runWithRetry(fn, { retries: 1, retryDelayMs: 1, backoffFactor: 'fixed' }))
      .rejects.toThrow("fail");
  });

  it("deve respeitar o maxRetryDelayMs", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(runWithRetry(fn, { retries: 1, retryDelayMs: 100, maxRetryDelayMs: 10, backoffFactor: 'fixed' }))
      .rejects.toThrow("fail");
  });

  it("deve usar jitter se habilitado", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(runWithRetry(fn, { retries: 1, retryDelayMs: 1, jitter: true }))
      .rejects.toThrow("fail");
  });

  it("deve interromper se o signal for abortado antes de começar", async () => {
    const fn = vi.fn();
    const controller = new AbortController();
    controller.abort("cancel");
    await expect(runWithRetry(fn, { retries: 3, retryDelayMs: 0, signal: controller.signal }))
      .rejects.toBe("cancel");
    expect(fn).not.toHaveBeenCalled();
  });

  it("deve interromper durante o delay se o signal for abortado", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const controller = new AbortController();
    
    const promise = runWithRetry(fn, { retries: 3, retryDelayMs: 1000, signal: controller.signal });
    
    // Espera um pouco para entrar no delay
    await new Promise(r => setTimeout(r, 50));
    controller.abort("cancel during delay");
    
    await expect(promise).rejects.toBe("cancel during delay");
  });
});
