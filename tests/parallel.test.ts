import { describe, expect, it } from "vitest";
import { create } from "../src";

describe("Parallel", () => {
  it("deve reportar status 'failed' quando um step paralelo falha (com failFast)", async () => {
    const result = await create("parallel-fail-test")
      .parallel("parallel-steps", [
        {
          name: "step-success",
          fn: async () => {},
        },
        {
          name: "step-fail",
          fn: async () => { throw new Error("falha proposital"); },
        }
      ], { failFast: true })
      .run({});

    expect(result.status).toBe("failed");
    
    const failedStep = result.steps.find(s => s.name === "step-fail");
    expect(failedStep?.status).toBe("failed");
    expect(failedStep?.error).toBeDefined();

    const successStep = result.steps.find(s => s.name === "step-success");
    expect(successStep?.status).toBe("completed");
  });
  it("deve compensar steps paralelos bem-sucedidos quando um falha (com failFast)", async () => {
    const compensated: string[] = [];

    const result = await create("parallel-compensate-test")
      .parallel("parallel-steps", [
        {
          name: "step-success",
          fn: async () => {},
          options: {
            compensate: () => { compensated.push("step-success"); }
          }
        },
        {
          name: "step-fail",
          fn: async () => { throw new Error("falha proposital"); },
        }
      ], { failFast: true })
      .run({});

    expect(result.status).toBe("failed");
    expect(compensated).toContain("step-success");
  });
  it("não deve falhar o grupo paralelo se apenas um falhar (comportamento padrão)", async () => {
    const result = await create("parallel-default-test")
      .parallel("parallel-steps", [
        {
          name: "step-success",
          fn: async () => {},
        },
        {
          name: "step-fail",
          fn: async () => { throw new Error("falha"); },
        }
      ])
      .run({});

    expect(result.status).toBe("completed");
  });
});
