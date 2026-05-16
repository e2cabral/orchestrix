import { FlowPlugin, FlowStartEvent, FlowCompleteEvent, FlowFailEvent, StepStartEvent, StepCompleteEvent, StepFailEvent, CompensateEvent } from "../types";
import { colors } from "../utils/logger";
import { stepStorage } from "../utils/storage";

/**
 * Options for the console logger plugin.
 */
export interface ConsoleLoggerPluginOptions {
  /** Optional prefix for all log messages. */
  prefix?: string;
  /** Whether to intercept console logs inside steps. Defaults to false. */
  intercept?: boolean;
}

/**
 * A plugin that logs flow lifecycle events to the console following the library's visual pattern.
 * 
 * @param options Plugin options.
 * @returns A FlowPlugin instance.
 */
export const createConsoleLoggerPlugin = (options: ConsoleLoggerPluginOptions = {}): FlowPlugin => {
  const getPrefix = () => options.prefix ? `${colors.gray}[${options.prefix}]${colors.reset} ` : '';

  if (options.intercept) {
    const interceptMethod = (method: keyof Console) => {
      const original = console[method] as Function;
      (console as any)[method] = (...args: any[]) => {
        const stepInfo = stepStorage.getStore();
        if (stepInfo) {
          const prefix = getPrefix();
          const stepTag = `${colors.gray}[${stepInfo.stepName}]${colors.reset}`;
          const internalFlag = `${colors.cyan}→${colors.reset}`;
          original(`${prefix}${stepTag} ${internalFlag}`, ...args);
        } else {
          original(...args);
        }
      };
    };

    interceptMethod('log');
    interceptMethod('info');
    interceptMethod('warn');
    interceptMethod('error');
  }

  return {
    name: 'console-logger',

    onFlowStart: (event: FlowStartEvent<any>) => {
      console.log(`\n${getPrefix()}${colors.bgRunning}${colors.bold} RUNNING ${colors.reset} ${colors.bold}${event.flowName}${colors.reset}`);
    },

    onStepStart: (event: StepStartEvent<any>) => {
      console.log(`${getPrefix()}  ${colors.gray}◌${colors.reset} ${colors.gray}${event.stepName}${colors.reset}`);
    },

    onStepComplete: (event: StepCompleteEvent<any>) => {
      const { stepName, result } = event;
      const duration = result.durationMs > 1000 ? `${(result.durationMs / 1000).toFixed(2)}s` : `${result.durationMs}ms`;
      const retries = result.attempts > 1 ? ` ${colors.yellow}(${result.attempts - 1} retries)${colors.reset}` : "";
      
      console.log(`${getPrefix()}  ${colors.green}✔${colors.reset} ${colors.bold}${stepName}${colors.reset} ${colors.gray}(${duration})${colors.reset}${retries}`);
    },

    onStepFail: (event: StepFailEvent<any>) => {
      const { stepName, error } = event;
      const duration = error.durationMs > 1000 ? `${(error.durationMs / 1000).toFixed(2)}s` : `${error.durationMs}ms`;
      const attempts = ` ${colors.yellow}(${error.attempts} attempts)${colors.reset}`;

      console.log(`${getPrefix()}  ${colors.red}✘${colors.reset} ${colors.bold}${colors.red}${stepName}${colors.reset} ${colors.gray}(${duration})${colors.reset}${attempts}`);
      
      if (error.error instanceof Error) {
        console.log(`${getPrefix()}    ${colors.red}${error.error.message}${colors.reset}`);
      } else {
        console.log(`${getPrefix()}    ${colors.red}${JSON.stringify(error.error)}${colors.reset}`);
      }
    },

    onCompensate: (event: CompensateEvent<any>) => {
      console.log(`${getPrefix()}  ${colors.yellow}↺${colors.reset} ${colors.gray}Compensating:${colors.reset} ${colors.bold}${event.stepName}${colors.reset}`);
    },

    onFlowComplete: (event: FlowCompleteEvent<any>) => {
      const { result } = event;
      const duration = result.durationMs > 1000 ? `${(result.durationMs / 1000).toFixed(2)}s` : `${result.durationMs}ms`;
      const statusLabel = result.status === 'completed' 
        ? `${colors.bgSuccess}${colors.bold} SUCCESS ${colors.reset}` 
        : result.status === 'cancelled'
          ? `${colors.bgCancelled}${colors.bold} CANCELLED ${colors.reset}`
          : `${colors.bgFailure}${colors.bold} FAILURE ${colors.reset}`;

      const successfulSteps = result.steps.filter((s: any) => s.status === 'completed').length;
      const failedSteps = result.steps.filter((s: any) => s.status === 'failed').length;

      console.log(`\n${getPrefix()}${statusLabel} ${colors.bold}${event.flowName}${colors.reset}`);
      console.log(`${getPrefix()}${colors.bold}Steps:    ${colors.reset}${colors.green}${successfulSteps} completed${colors.reset}, ${failedSteps > 0 ? `${colors.red}${failedSteps} failed, ` : ""}${result.steps.length} total`);
      console.log(`${getPrefix()}${colors.bold}Duration: ${colors.reset}${duration}`);
      console.log(`${getPrefix()}${colors.gray}${"-".repeat(40)}${colors.reset}\n`);
    },

    onFlowFail: (event: FlowFailEvent<any>) => {
      const duration = event.result instanceof Error ? 0 : (event.result as any).durationMs || 0; // fallback simplificado
      const durationStr = duration > 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`;
      
      console.log(`\n${getPrefix()}${colors.bgFailure}${colors.bold} FAILURE ${colors.reset} ${colors.bold}${event.flowName}${colors.reset}`);
      if (event.result instanceof Error) {
        console.log(`${getPrefix()}${colors.red}Error: ${event.result.message}${colors.reset}`);
      } else {
        console.log(`${getPrefix()}${colors.red}Error: ${JSON.stringify(event.result)}${colors.reset}`);
      }
      console.log(`${getPrefix()}${colors.bold}Duration: ${colors.reset}${durationStr}`);
      console.log(`${getPrefix()}${colors.gray}${"-".repeat(40)}${colors.reset}\n`);
    }
  };
};
