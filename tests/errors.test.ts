import { describe, expect, it } from "vitest";
import { 
  OrchestrixError, 
  StepAlreadyExistsError, 
  FlowAlreadyRunningError, 
  IdempotencyRecordNotFoundError, 
  StepTimeoutError, 
  FlowValidationError 
} from "../src/errors";

describe("Errors", () => {
  it("OrchestrixError", () => {
    const error = new OrchestrixError("msg");
    expect(error.message).toBe("msg");
    expect(error.name).toBe("OrchestrixError");
  });

  it("StepAlreadyExistsError", () => {
    const error = new StepAlreadyExistsError("s1");
    expect(error.message).toContain("'s1'");
    expect(error.name).toBe("StepAlreadyExistsError");
  });

  it("FlowAlreadyRunningError", () => {
    const error = new FlowAlreadyRunningError("f1", "k1");
    expect(error.message).toContain("'f1'");
    expect(error.message).toContain("'k1'");
    expect(error.name).toBe("FlowAlreadyRunningError");
  });

  it("IdempotencyRecordNotFoundError", () => {
    const error = new IdempotencyRecordNotFoundError("k1");
    expect(error.message).toContain("k1");
    expect(error.name).toBe("IdempotencyRecordNotFoundError");
  });

  it("StepTimeoutError", () => {
    const error = new StepTimeoutError("s1", 100);
    expect(error.message).toContain("'s1'");
    expect(error.message).toContain("100ms");
    expect(error.name).toBe("StepTimeoutError");
  });

  it("FlowValidationError", () => {
    const issues = [{ path: "p1", message: "m1" }];
    const error = new FlowValidationError(issues);
    expect(error.message).toBe("Flow input validation failed");
    expect(error.issues).toBe(issues);
    expect(error.name).toBe("FlowValidationError");
  });
});
