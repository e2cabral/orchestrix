import { FlowPlugin, FlowStartEvent, FlowCompleteEvent, FlowFailEvent } from "../types";

/**
 * A simple plugin that logs flow lifecycle events to the console.
 * This is a basic example of how to implement a plugin.
 * 
 * @param options Plugin options.
 * @returns A FlowPlugin instance.
 */
export const createConsoleLoggerPlugin = (options: { prefix?: string } = {}): FlowPlugin => {
  const getPrefix = () => options.prefix ? `[${options.prefix}] ` : '';

  return {
    name: 'console-logger',
    onFlowStart: (event: FlowStartEvent<any>) => {
      console.log(`${getPrefix()}Flow started: ${event.flowName}`);
    },
    onFlowComplete: (event: FlowCompleteEvent<any>) => {
      console.log(`${getPrefix()}Flow completed: ${event.flowName} (${event.result.durationMs}ms)`);
    },
    onFlowFail: (event: FlowFailEvent<any>) => {
      console.log(`${getPrefix()}Flow failed: ${event.flowName}`);
    }
  };
};
