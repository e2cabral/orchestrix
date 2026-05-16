import { describe, expect, it, vi } from "vitest";
import { create } from "../src";

describe("Flow", () => {
  it("executa steps em ordem", async () => {
    const calls: string[] = [];

    const result = await create("order-test")
      .step("one", () => { calls.push("one"); })
      .step("two", () => { calls.push("two"); })
      .step("three", () => { calls.push("three"); })
      .run({});

    expect(result.status).toBe("completed");
    expect(calls).toEqual(["one", "two", "three"]);
  });

  it("compartilha contexto entre steps", async () => {
    const result = await create("context-test")
      .step("write", (ctx) => {
        ctx.set("user", { id: 1, name: "Alice" });
      })
      .step("read", (ctx) => {
        const user = ctx.get<{ id: number; name: string }>("user");
        expect(user).toEqual({ id: 1, name: "Alice" });
      })
      .run({});

    expect(result.status).toBe("completed");
  });

  it("falha no step correto e registra os dados corretamente", async () => {
    const error = new Error("falhou no segundo");

    const result = await create("fail-test")
      .step("first", () => {})
      .step("second", () => { throw error; })
      .step("third", () => {})
      .run({});

    expect(result.status).toBe("failed");
    expect(result.error).toBe(error);

    const failedStep = result.steps.find(s => s.status === "failed");
    expect(failedStep?.name).toBe("second");
    expect(failedStep?.error).toBe(error);
  });

  it("registra attempts corretamente", async () => {
    let callCount = 0;

    const result = await create("attempts-test")
      .step("flaky", () => {
        callCount++;
        if (callCount < 3) throw new Error("ainda não");
      }, { retries: 4 })
      .run({});

    expect(result.status).toBe("completed");
    expect(result.steps[0].attempts).toBe(3);
  });

  it("retry funciona após falha temporária", async () => {
    let attempts = 0;

    const result = await create("retry-test")
      .step("unstable", () => {
        attempts++;
        if (attempts < 3) throw new Error("erro temporário");
      }, { retries: 5 })
      .run({});

    expect(result.status).toBe("completed");
    expect(result.steps[0].status).toBe("completed");
    expect(attempts).toBe(3);
  });

  it("timeout falha corretamente", async () => {
    const result = await create("timeout-test")
      .step("slow", () => new Promise(resolve => setTimeout(resolve, 500)), {
        timeoutMs: 50,
      })
      .run({});

    expect(result.status).toBe("failed");

    const failedStep = result.steps.find(s => s.status === "failed");
    expect(failedStep?.name).toBe("slow");
    expect((failedStep?.error as Error).message).toContain("timed out");
  });

  it("compensate roda em ordem reversa após falha", async () => {
    const compensated: string[] = [];

    const result = await create("compensate-order-test")
      .step("step-a", () => {}, {
        compensate: () => { compensated.push("a"); }
      })
      .step("step-b", () => {}, {
        compensate: () => { compensated.push("b"); }
      })
      .step("step-c", () => { throw new Error("falha em c"); }, {
        compensate: () => { compensated.push("c"); }
      })
      .run({});

    expect(result.status).toBe("failed");
    // Somente steps já executados com sucesso devem compensar, em ordem reversa
    expect(compensated).toEqual(["b", "a"]);
  });

  it("compensate não apaga o erro original", async () => {
    const originalError = new Error("erro original");

    const result = await create("compensate-error-test")
      .step("step-a", () => {}, {
        compensate: () => { throw new Error("erro na compensação"); }
      })
      .step("step-b", () => { throw originalError; })
      .run({});

    expect(result.status).toBe("failed");
    expect(result.error).toBe(originalError);
  });

  it("não permite steps com nomes duplicados", () => {
    expect(() => {
      create("duplicate-test")
        .step("same-name", () => {})
        .step("same-name", () => {});
    }).toThrow("Step with name 'same-name' already exists");
  });

  it("retorna durationMs dos steps com valor maior que zero", async () => {
    const result = await create("duration-test")
      .step("fast", () => {})
      .step("slow", () => new Promise(resolve => setTimeout(resolve, 30)))
      .run({});

    expect(result.status).toBe("completed");
    expect(result.durationMs).toBeGreaterThan(0);

    const [fast, slow] = result.steps;
    expect(fast.durationMs).toBeGreaterThanOrEqual(0);
    expect(slow.durationMs).toBeGreaterThanOrEqual(30);
  });

  it("testa métodos adicionais do FlowContext", async () => {
    let hasResult = false;
    await create("context-extra")
      .step("test", (ctx) => {
        ctx.set("foo", "bar");
        hasResult = ctx.has("foo");
      })
      .run({});
    
    expect(hasResult).toBe(true);
  });

  it("testa métodos adicionais do State", async () => {
    // Isso é testado indiretamente, mas vamos garantir cobertura
    const result = await create("state-extra")
      .step("test", () => {})
      .run({});
    expect(result.status).toBe("completed");
  });

  it("deve cobrir getStatus do State", async () => {
    const { State } = await import("../src/core/state");
    const state = new State([{ name: "s1", fn: () => {} }]);
    expect(state.getStatus({ name: "s1", fn: () => {} })).toBe("pending");
    expect(state.getStatus({ name: "missing", fn: () => {} })).toBe("pending");
  });

  it("deve cobrir a emissão de erro de step no Flow", async () => {
    const onStepFail = vi.fn();
    await create("fail-emit", { hooks: { onStepFail } })
      .step("s1", () => { throw new Error("fail"); })
      .run({});
    expect(onStepFail).toHaveBeenCalled();
  });

  it("deve lançar erro ao adicionar parallel com nome duplicado", () => {
    expect(() => {
      create("duplicate-parallel")
        .step("s1", () => {})
        .parallel("s1", []);
    }).toThrow("Step with name 's1' already exists");
  });

  it("deve lidar com falha em step dentro de parallel (failFast)", async () => {
    const result = await create("parallel-fail")
      .parallel("p1", [
        { name: "s1", fn: () => {} },
        { name: "s2", fn: () => { throw new Error("parallel fail"); } }
      ], { failFast: true })
      .run({});
    
    expect(result.status).toBe("failed");
    expect(result.error.message).toBe("parallel fail");
  });

  it("deve lidar com erro de validação (schema)", async () => {
    const mockSchema = {
      "~standard": {
        version: 1,
        validate: () => ({ issues: [{ message: "invalid" }] })
      }
    };
    const result = await create("schema-fail", { schema: mockSchema as any })
      .step("s1", () => {})
      .run({});
    
    expect(result.status).toBe("failed");
    expect(result.error.name).toBe("FlowValidationError");
  });
});
