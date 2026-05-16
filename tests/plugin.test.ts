import { describe, it, expect, vi } from 'vitest';
import { create, createConsoleLoggerPlugin } from '../src';

describe('Flow Plugins', () => {
  it('should call plugin hooks during flow execution', async () => {
    const onFlowStart = vi.fn();
    const onStepStart = vi.fn();
    const onStepComplete = vi.fn();
    const onFlowComplete = vi.fn();

    const testPlugin = {
      name: 'test-plugin',
      onFlowStart,
      onStepStart,
      onStepComplete,
      onFlowComplete,
    };

    const flow = create('test-flow', {
      plugins: [testPlugin]
    })
    .step('step-1', () => 'ok');

    await flow.run({});

    expect(onFlowStart).toHaveBeenCalledTimes(1);
    expect(onStepStart).toHaveBeenCalledTimes(1);
    expect(onStepComplete).toHaveBeenCalledTimes(1);
    expect(onFlowComplete).toHaveBeenCalledTimes(1);
  });

  it('should call multiple plugins in order', async () => {
    const order: string[] = [];

    const plugin1 = {
      name: 'p1',
      onFlowStart: () => { order.push('p1'); }
    };

    const plugin2 = {
      name: 'p2',
      onFlowStart: () => { order.push('p2'); }
    };

    const flow = create('test-order', {
      plugins: [plugin1, plugin2]
    }).step('s1', () => {});

    await flow.run({});

    expect(order).toEqual(['p1', 'p2']);
  });

  it('should not break flow if plugin fails', async () => {
    const buggyPlugin = {
      name: 'buggy',
      onFlowStart: () => { throw new Error('Plugin error'); }
    };

    const flow = create('test-buggy', {
      plugins: [buggyPlugin]
    }).step('s1', () => 'success');

    const result = await flow.run({});

    expect(result.status).toBe('completed');
  });

  it('should work with built-in console logger plugin', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    const flow = create('test-console-logger', {
      plugins: [createConsoleLoggerPlugin({ prefix: 'TEST' })]
    }).step('s1', () => {});

    await flow.run({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/RUNNING.*test-console-logger/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/SUCCESS.*test-console-logger/));
    
    logSpy.mockRestore();
  });

  it('should intercept console logs inside steps', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const flow = create('test-intercept', {
      plugins: [createConsoleLoggerPlugin({ prefix: 'TEST', intercept: true })]
    }).step('s1', () => {
      console.log('internal log');
    });

    await flow.run({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\[TEST\].*\[s1\].*→/), 'internal log');

    logSpy.mockRestore();
  });

  it('should call both global hooks and plugins', async () => {
    const globalHook = vi.fn();
    const pluginHook = vi.fn();

    const flow = create('test-both', {
      hooks: { onFlowStart: globalHook },
      plugins: [{ name: 'p1', onFlowStart: pluginHook }]
    }).step('s1', () => {});

    await flow.run({});

    expect(globalHook).toHaveBeenCalled();
    expect(pluginHook).toHaveBeenCalled();
  });

  it('should cover all ConsoleLoggerPlugin hooks', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    const flow = create('test-full-logger', {
      plugins: [createConsoleLoggerPlugin({ prefix: 'TEST' })]
    })
    .step('s1', () => {}, { compensate: () => {} })
    .step('s2', () => { throw new Error('fail'); });

    await flow.run({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/FAILURE.*test-full-logger/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/↺.*Compensating:.*s1/));
    
    logSpy.mockRestore();
  });
});
