import {
  FlowStartEvent,
  StepCompleteEvent,
  StepFailEvent,
  CompensateEvent,
  FlowCompleteEvent,
  FlowFailEvent,
  FlowLoggerOptions
} from "../types";

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  bgPass: "\x1b[42m\x1b[30m",
  bgFail: "\x1b[41m\x1b[30m",
  bgCancel: "\x1b[43m\x1b[30m",
};

export class FlowLogger {
  private startTime: number = 0;
  private totalSteps: number = 0;

  constructor(private options: FlowLoggerOptions = { enabled: true }) {}

  private log(message: string) {
    if (this.options.enabled) {
      const prefix = this.options.prefix ? `${colors.gray}[${this.options.prefix}]${colors.reset} ` : "";
      console.log(`${prefix}${message}`);
    }
  }

  onFlowStart(event: FlowStartEvent<any>, totalSteps: number) {
    this.startTime = Date.now();
    this.totalSteps = totalSteps;
    this.log(`\n${colors.bold}${colors.cyan}RUNS${colors.reset} ${colors.bold}${event.flowName}${colors.reset}`);
  }

  onStepStart(event: any) {
    // Para steps normais, talvez não queiramos logar logo no início para não poluir
    // Mas o Jest mostra o que está rodando.
  }

  onStepComplete(event: StepCompleteEvent<any>) {
    const { stepName, result } = event;
    const duration = result.durationMs > 1000 ? `${(result.durationMs / 1000).toFixed(2)}s` : `${result.durationMs}ms`;
    const retries = result.attempts > 1 ? ` ${colors.yellow}(${result.attempts - 1} retries)${colors.reset}` : "";
    
    this.log(`  ${colors.green}✓${colors.reset} ${colors.gray}${stepName}${colors.reset} ${colors.gray}(${duration})${colors.reset}${retries}`);
  }

  onStepFail(event: StepFailEvent<any>) {
    const { stepName, error } = event;
    const duration = error.durationMs > 1000 ? `${(error.durationMs / 1000).toFixed(2)}s` : `${error.durationMs}ms`;
    const attempts = ` ${colors.yellow}(${error.attempts} attempts)${colors.reset}`;

    this.log(`  ${colors.red}✕${colors.reset} ${colors.bold}${colors.red}${stepName}${colors.reset} ${colors.gray}(${duration})${colors.reset}${attempts}`);
    
    if (error.error instanceof Error) {
      this.log(`    ${colors.red}${error.error.message}${colors.reset}`);
    } else {
      this.log(`    ${colors.red}${JSON.stringify(error.error)}${colors.reset}`);
    }
  }

  onCompensate(event: CompensateEvent<any>) {
    this.log(`  ${colors.yellow}↺${colors.reset} ${colors.gray}Compensating:${colors.reset} ${colors.bold}${event.stepName}${colors.reset}`);
  }

  onFlowComplete(event: FlowCompleteEvent<any>) {
    const { result } = event;
    const duration = result.durationMs > 1000 ? `${(result.durationMs / 1000).toFixed(2)}s` : `${result.durationMs}ms`;
    const statusLabel = result.status === 'completed' 
      ? `${colors.bgPass} PASS ${colors.reset}` 
      : result.status === 'cancelled'
        ? `${colors.bgCancel} CANCEL ${colors.reset}`
        : `${colors.bgFail} FAIL ${colors.reset}`;

    const successfulSteps = result.steps.filter((s: any) => s.status === 'completed').length;
    const failedSteps = result.steps.filter((s: any) => s.status === 'failed').length;

    this.log(`\n${statusLabel} ${colors.bold}${event.flowName}${colors.reset}`);
    this.log(`${colors.bold}Steps:    ${colors.reset}${colors.green}${successfulSteps} passed${colors.reset}, ${failedSteps > 0 ? `${colors.red}${failedSteps} failed, ` : ""}${result.steps.length} total`);
    this.log(`${colors.bold}Time:     ${colors.reset}${duration}`);
    this.log(`${colors.gray}${"-".repeat(40)}${colors.reset}\n`);
  }

  onFlowFail(event: FlowFailEvent<any>) {
    // onFlowFail geralmente acontece quando algo quebra fora do controle de steps (ex: erro no schema)
    const duration = Date.now() - this.startTime;
    const durationStr = duration > 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`;
    
    this.log(`\n${colors.bgFail} FAIL ${colors.reset} ${colors.bold}${event.flowName}${colors.reset}`);
    if (event.result instanceof Error) {
      this.log(`${colors.red}Error: ${event.result.message}${colors.reset}`);
    } else {
      this.log(`${colors.red}Error: ${JSON.stringify(event.result)}${colors.reset}`);
    }
    this.log(`${colors.bold}Time:     ${colors.reset}${durationStr}`);
    this.log(`${colors.gray}${"-".repeat(40)}${colors.reset}\n`);
  }
}
