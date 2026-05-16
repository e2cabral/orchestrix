import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create } from '../src';

describe('FlowLogger', () => {
  let logSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('should log flow execution steps and completion', async () => {
    const flow = create('test-flow', { logging: true })
      .step('step-1', async () => 'ok')
      .step('step-2', async () => 'ok', { retries: 1 });

    await flow.run({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/RUNNING.*test-flow/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/✔.*step-1/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/✔.*step-2/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/SUCCESS.*test-flow/));
  });

  it('should log failures and retries', async () => {
    let attempts = 0;
    const flow = create('fail-flow', { logging: true })
      .step('fail-step', async () => {
        attempts++;
        if (attempts < 2) throw new Error('First fail');
        return 'success';
      }, { retries: 1 });

    await flow.run({});

    // O primeiro erro não é logado como onStepFail se houver retry?
    // Na verdade, o executeStep só chama onStepFail se todas as tentativas falharem.
    // Se passar no retry, ele chama onStepComplete com attempts > 1.
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/✔.*fail-step/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('(1 retries)'));
  });

  it('should log fatal failures', async () => {
    const flow = create('fatal-flow', { logging: true })
      .step('fail-step', () => { throw new Error('Fatal') });

    await flow.run({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/✘.*fail-step/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Fatal'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/FAILURE.*fatal-flow/));
  });

  it('should log compensations', async () => {
    const flow = create('compensate-flow', { logging: true })
      .step('step-1', () => {}, { compensate: async () => {} })
      .step('fail-step', () => { throw new Error('Fail') });

    await flow.run({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/↺.*Compensating:.*step-1/));
  });

  it('should support prefix', async () => {
    const flow = create('prefix-flow', { 
      logging: { enabled: true, prefix: 'APP' } 
    })
      .step('step-1', () => {});

    await flow.run({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[APP]'));
  });

  it('should respect enabled: false', async () => {
    const flow = create('silent-flow', { logging: false })
      .step('step-1', () => {});

    await flow.run({});

    expect(logSpy).not.toHaveBeenCalled();
  });
});
