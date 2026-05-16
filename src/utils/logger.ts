import {
  FlowStartEvent,
  StepCompleteEvent,
  StepFailEvent,
  CompensateEvent,
  FlowCompleteEvent,
  FlowFailEvent,
  FlowLoggerOptions,
  FlowPlugin,
  StepStartEvent,
  CompensateCompleteEvent
} from "../types";

export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgSuccess: "\x1b[42m\x1b[30m",
  bgFailure: "\x1b[41m\x1b[37m",
  bgRunning: "\x1b[44m\x1b[37m",
  bgCancelled: "\x1b[43m\x1b[30m",
};

export class FlowLogger implements FlowPlugin {
  public readonly name = 'flow-logger';
  private startTime: number = 0;
  private totalSteps: number = 0;

  constructor(private options: FlowLoggerOptions = { enabled: true }) {}

  private log(message: string) {
    if (this.options.enabled) {
      const prefix = this.options.prefix ? `${colors.gray}[${this.options.prefix}]${colors.reset} ` : "";
      console.log(`${prefix}${message}`);
    }
  }

  onFlowStart(event: FlowStartEvent<any>, totalSteps?: number) {
    this.startTime = Date.now();
    this.totalSteps = totalSteps || 0;
    this.log(`\n${colors.bgRunning}${colors.bold} RUNNING ${colors.reset} ${colors.bold}${event.flowName}${colors.reset}`);
  }

  onStepStart(event: StepStartEvent<any>) {
    this.log(`  ${colors.gray}◌${colors.reset} ${colors.gray}${event.stepName}${colors.reset}`);
  }

  onStepComplete(event: StepCompleteEvent<any>) {
    const { stepName, result } = event;
    const duration = result.durationMs > 1000 ? `${(result.durationMs / 1000).toFixed(2)}s` : `${result.durationMs}ms`;
    const retries = result.attempts > 1 ? ` ${colors.yellow}(${result.attempts - 1} retries)${colors.reset}` : "";
    
    this.log(`  ${colors.green}✔${colors.reset} ${colors.bold}${stepName}${colors.reset} ${colors.gray}(${duration})${colors.reset}${retries}`);
  }

  onStepFail(event: StepFailEvent<any>) {
    const { stepName, error } = event;
    const duration = error.durationMs > 1000 ? `${(error.durationMs / 1000).toFixed(2)}s` : `${error.durationMs}ms`;
    const attempts = ` ${colors.yellow}(${error.attempts} attempts)${colors.reset}`;

    this.log(`  ${colors.red}✘${colors.reset} ${colors.bold}${colors.red}${stepName}${colors.reset} ${colors.gray}(${duration})${colors.reset}${attempts}`);
    
    if (error.error instanceof Error) {
      this.log(`    ${colors.red}${error.error.message}${colors.reset}`);
    } else {
      this.log(`    ${colors.red}${JSON.stringify(error.error)}${colors.reset}`);
    }
  }

  onCompensate(event: CompensateEvent<any>) {
    this.log(`  ${colors.yellow}↺${colors.reset} ${colors.gray}Compensating:${colors.reset} ${colors.bold}${event.stepName}${colors.reset}`);
  }

  onCompensateComplete(_event: CompensateCompleteEvent<any>) {
    // Optional: could log something here if needed
  }

  onFlowComplete(event: FlowCompleteEvent<any>) {
    const { result } = event;
    const duration = result.durationMs > 1000 ? `${(result.durationMs / 1000).toFixed(2)}s` : `${result.durationMs}ms`;
    const statusLabel = result.status === 'completed' 
      ? `${colors.bgSuccess}${colors.bold} SUCCESS ${colors.reset}` 
      : result.status === 'cancelled'
        ? `${colors.bgCancelled}${colors.bold} CANCELLED ${colors.reset}`
        : `${colors.bgFailure}${colors.bold} FAILURE ${colors.reset}`;

    const successfulSteps = result.steps.filter((s: any) => s.status === 'completed').length;
    const failedSteps = result.steps.filter((s: any) => s.status === 'failed').length;

    this.log(`\n${statusLabel} ${colors.bold}${event.flowName}${colors.reset}`);
    this.log(`${colors.bold}Steps:    ${colors.reset}${colors.green}${successfulSteps} completed${colors.reset}, ${failedSteps > 0 ? `${colors.red}${failedSteps} failed, ` : ""}${result.steps.length} total`);
    this.log(`${colors.bold}Duration: ${colors.reset}${duration}`);
    this.log(`${colors.gray}${"-".repeat(40)}${colors.reset}\n`);
  }

  onFlowFail(event: FlowFailEvent<any>) {
    const duration = Date.now() - this.startTime;
    const durationStr = duration > 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`;
    
    this.log(`\n${colors.bgFailure}${colors.bold} FAILURE ${colors.reset} ${colors.bold}${event.flowName}${colors.reset}`);
    if (event.result instanceof Error) {
      this.log(`${colors.red}Error: ${event.result.message}${colors.reset}`);
    } else {
      this.log(`${colors.red}Error: ${JSON.stringify(event.result)}${colors.reset}`);
    }
    this.log(`${colors.bold}Duration: ${colors.reset}${durationStr}`);
    this.log(`${colors.gray}${"-".repeat(40)}${colors.reset}\n`);
  }
}
