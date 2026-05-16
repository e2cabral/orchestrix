import { describe, it, expect, vi } from 'vitest';
import { create } from '../src';

describe('Flow Cancellation (AbortSignal)', () => {
  it('should cancel the flow before starting a step', async () => {
    const controller = new AbortController();
    const step1 = vi.fn().mockResolvedValue(undefined);
    const step2 = vi.fn().mockResolvedValue(undefined);

    const flow = create('cancel-before-step')
      .step('step1', async () => {
        controller.abort('Manual cancellation');
        await step1();
      })
      .step('step2', step2);

    const result = await flow.run({}, { signal: controller.signal });

    expect(result.status).toBe('cancelled');
    expect(result.error).toBe('Manual cancellation');
    expect(step1).toHaveBeenCalled();
    expect(step2).not.toHaveBeenCalled();
  });

  it('should propagate AbortSignal to the step function via context', async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;

    const flow = create('propagate-signal')
      .step('step1', async (ctx) => {
        capturedSignal = ctx.signal;
      });

    await flow.run({}, { signal: controller.signal });

    expect(capturedSignal).toBe(controller.signal);
  });

  it('should cancel during a retry delay', async () => {
    const controller = new AbortController();
    const step1 = vi.fn().mockRejectedValue(new Error('Fail'));

    const flow = create('cancel-during-retry')
      .step('step1', step1, { retries: 2, retryDelayMs: 1000 });

    const runPromise = flow.run({}, { signal: controller.signal });

    // Wait a bit and then abort
    setTimeout(() => controller.abort('Abort during retry'), 100);

    const result = await runPromise;

    expect(result.status).toBe('failed'); // it fails because step1 throws, then runWithRetry catches it and waits, then it gets aborted
    // Wait, if it gets aborted during retry delay, runWithRetry throws the reason.
    // In executeStep, this is caught and status becomes 'failed'.
    expect(result.error).toBe('Abort during retry');
  });

  it('should trigger compensations when cancelled', async () => {
    const controller = new AbortController();
    const compensate1 = vi.fn().mockResolvedValue(undefined);

    const flow = create('cancel-with-compensation')
      .step('step1', () => {}, { compensate: compensate1 })
      .step('step2', async () => {
        controller.abort('Cancel now');
      });

    const result = await flow.run({}, { signal: controller.signal });

    expect(result.status).toBe('cancelled');
    expect(compensate1).toHaveBeenCalled();
  });
});
