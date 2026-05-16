import { describe, expect, it } from "vitest";
import { create } from "../src";
import { FlowValidationError } from "../src/errors";

describe("Schema Validation", () => {
  // Mock de um Standard Schema V1
  const createMockSchema = (validateFn: (input: any) => any) => ({
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: validateFn
    }
  });

  it("deve permitir a execução se o input for válido", async () => {
    const schema = createMockSchema((input) => ({ value: input }));
    const calls: any[] = [];

    const result = await create("valid-input", { schema })
      .step("step1", (ctx) => {
        calls.push(ctx.input);
      })
      .run({ name: "test" });

    expect(result.status).toBe("completed");
    expect(calls).toEqual([{ name: "test" }]);
  });

  it("deve falhar se o input for inválido", async () => {
    const issues = [{ message: "Invalid input", path: ["name"] }];
    const schema = createMockSchema(() => ({ issues }));
    
    const calls: any[] = [];

    const result = await create("invalid-input", { schema })
      .step("step1", () => {
        calls.push("should not be called");
      })
      .run({ name: "" });

    expect(result.status).toBe("failed");
    expect(result.error).toBeInstanceOf(FlowValidationError);
    expect((result.error as FlowValidationError).issues).toEqual(issues);
    expect(calls).toHaveLength(0);
    expect(result.steps).toHaveLength(0);
  });

  it("deve funcionar com validação assíncrona", async () => {
    const schema = createMockSchema(async (input) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { value: input };
    });

    const result = await create("async-validation", { schema })
      .step("step1", () => {})
      .run({ test: true });

    expect(result.status).toBe("completed");
  });

  it("deve falhar com validação assíncrona inválida", async () => {
    const issues = [{ message: "Async failure" }];
    const schema = createMockSchema(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { issues };
    });

    const result = await create("async-invalid", { schema })
      .step("step1", () => {})
      .run({});

    expect(result.status).toBe("failed");
    expect(result.error).toBeInstanceOf(FlowValidationError);
  });

  it("deve propagar erro se o validador lançar uma exceção", async () => {
    const error = new Error("Validator crashed");
    const schema = createMockSchema(() => {
      throw error;
    });

    const flow = create("validator-crash", { schema }).step("step1", () => {});
    
    await expect(flow.run({})).rejects.toThrow("Validator crashed");
  });
});
