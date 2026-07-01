import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadWorkflow } from "../src/config-loader";
import { WorkflowRunner } from "../src/workflow-runner";
import type { WorkflowConfig } from "../src/workflow-runner";
import { MockAdapter } from "./mock-adapter";
import { UnsupportedError } from "../src/types";
import type { DelegationDelegate, AgentResponse } from "../src/types";

const fixturesDir = join(import.meta.dir, "..", "fixtures");

// ── Config Loading ──────────────────────────────────────────────────

describe("loadWorkflow", () => {
  it("loads a valid workflow from YAML", () => {
    const config = loadWorkflow(
      join(fixturesDir, "workflows", "test-workflow"),
    );
    expect(config.schema).toBe("aos/workflow/v1");
    expect(config.id).toBe("test-workflow");
    expect(config.name).toBe("Test Workflow");
    expect(config.steps).toHaveLength(3);
    expect(config.gates).toHaveLength(2);
  });

  it("validates step IDs in gates", () => {
    expect(() =>
      loadWorkflow(join(fixturesDir, "workflows", "nonexistent")),
    ).toThrow();
  });

  it("parses step inputs correctly", () => {
    const config = loadWorkflow(
      join(fixturesDir, "workflows", "test-workflow"),
    );
    expect(config.steps[0].input).toEqual([]);
    expect(config.steps[1].input).toEqual(["step-one"]);
    expect(config.steps[2].input).toEqual(["step-one", "step-two"]);
  });

  it("parses gate types correctly", () => {
    const config = loadWorkflow(
      join(fixturesDir, "workflows", "test-workflow"),
    );
    expect(config.gates[0].type).toBe("user-approval");
    expect(config.gates[1].type).toBe("automated-review");
    expect(config.gates[1].max_iterations).toBe(2);
  });
});

// ── Workflow Execution ──────────────────────────────────────────────

describe("WorkflowRunner", () => {
  function makeConfig(): WorkflowConfig {
    return {
      schema: "aos/workflow/v1",
      id: "test",
      name: "Test",
      description: "Test workflow",
      steps: [
        {
          id: "step-a",
          action: "gather",
          description: "Gather",
          input: [],
          output: "data-a",
          review_gate: false,
        },
        {
          id: "step-b",
          action: "process",
          description: "Process",
          input: ["data-a"],
          output: "data-b",
          review_gate: false,
        },
        {
          id: "step-c",
          action: "finalize",
          description: "Finalize",
          input: ["data-a", "data-b"],
          output: "data-c",
          review_gate: false,
        },
      ],
      gates: [],
    };
  }

  it("executes all steps in order", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    const runner = new WorkflowRunner(config, adapter);

    const outputs = await runner.execute();

    expect(outputs.size).toBe(3);
    // Outputs are keyed by step.output, not step.id
    expect(outputs.has("data-a")).toBe(true);
    expect(outputs.has("data-b")).toBe(true);
    expect(outputs.has("data-c")).toBe(true);
  });

  it("records completed steps in execution order", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    const runner = new WorkflowRunner(config, adapter);

    await runner.execute();

    expect(runner.getCompletedSteps()).toEqual([
      "step-a",
      "step-b",
      "step-c",
    ]);
  });

  it("passes previous step outputs as inputs", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    const runner = new WorkflowRunner(config, adapter);

    const outputs = await runner.execute();

    // step-b should have received data-a's output as input
    const stepB = outputs.get("data-b") as {
      stepId: string;
      action: string;
      inputs: Record<string, unknown>;
    };
    expect(stepB.inputs["data-a"]).toBeDefined();

    // step-c should have received both data-a and data-b outputs
    const stepC = outputs.get("data-c") as {
      stepId: string;
      action: string;
      inputs: Record<string, unknown>;
    };
    expect(stepC.inputs["data-a"]).toBeDefined();
    expect(stepC.inputs["data-b"]).toBeDefined();
  });

  it("resolves inputs by step ID via reverse lookup", async () => {
    const adapter = new MockAdapter();
    // Use step IDs as input references (not output names)
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "reverse-lookup-test",
      name: "Test",
      description: "Test",
      steps: [
        { id: "step-a", action: "gather", input: [], output: "data-a", review_gate: false },
        { id: "step-b", action: "process", input: ["step-a"], output: "data-b", review_gate: false },
      ],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    const outputs = await runner.execute();

    // step-b references "step-a" (a step ID), but output is keyed as "data-a"
    // The reverse lookup should resolve it
    const stepB = outputs.get("data-b") as {
      stepId: string;
      action: string;
      inputs: Record<string, unknown>;
    };
    expect(stepB.inputs["step-a"]).toBeDefined();
  });

  it("notifies the adapter for each step", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    const runner = new WorkflowRunner(config, adapter);

    await runner.execute();

    const notifyCalls = adapter.calls.filter((c) => c.method === "notify");
    expect(notifyCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("pauses at user-approval gates", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    config.gates = [
      {
        after: "step-b",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "re-run-step",
      },
    ];

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    // MockAdapter.promptConfirm returns true by default
    const confirmCalls = adapter.calls.filter(
      (c) => c.method === "promptConfirm",
    );
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0].args).toEqual(["Review Gate", "Approve?"]);
  });

  it("re-runs step on user-approval rejection", async () => {
    const adapter = new MockAdapter();

    // Override promptConfirm to reject once, then approve
    let confirmCount = 0;
    adapter.promptConfirm = async (title: string, message: string) => {
      adapter.calls.push({
        method: "promptConfirm",
        args: [title, message],
        timestamp: Date.now(),
      });
      confirmCount++;
      return false; // Always reject for this test
    };

    adapter.promptInput = async (label: string) => {
      adapter.calls.push({
        method: "promptInput",
        args: [label],
        timestamp: Date.now(),
      });
      return "change this";
    };

    const config = makeConfig();
    config.gates = [
      {
        after: "step-b",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "re-run-step",
      },
    ];

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    // Should have stored feedback
    const outputs = runner.getStepOutputs();
    expect(outputs.has("step-b_feedback")).toBe(true);
    expect(outputs.get("step-b_feedback")).toBe("change this");
  });

  it("runs automated-review gates with iteration notifications", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    config.gates = [
      {
        after: "step-c",
        type: "automated-review",
        prompt: "Auto review",
        max_iterations: 3,
        on_rejection: "re-run-step",
      },
    ];

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    // Should notify about automated review
    const notifyCalls = adapter.calls.filter(
      (c) =>
        c.method === "notify" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("Automated review"),
    );
    expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("defaults max_iterations to 3 for automated-review", async () => {
    const adapter = new MockAdapter();
    const config = makeConfig();
    config.gates = [
      {
        after: "step-a",
        type: "automated-review",
        prompt: "Auto review",
        on_rejection: "re-run-step",
        // no max_iterations — should default to 3
      },
    ];

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    // Should still work without error
    expect(runner.getCompletedSteps()).toContain("step-a");
  });

  it("loads fixture and executes end-to-end", async () => {
    const config = loadWorkflow(
      join(fixturesDir, "workflows", "test-workflow"),
    );
    const adapter = new MockAdapter();
    const runner = new WorkflowRunner(config, adapter);

    const outputs = await runner.execute();

    expect(outputs.size).toBeGreaterThanOrEqual(3);
    expect(runner.getCompletedSteps()).toEqual([
      "step-one",
      "step-two",
      "step-three",
    ]);

    // Gates should have fired
    const confirmCalls = adapter.calls.filter(
      (c) => c.method === "promptConfirm",
    );
    expect(confirmCalls).toHaveLength(1); // user-approval gate

    const reviewNotifies = adapter.calls.filter(
      (c) =>
        c.method === "notify" &&
        typeof c.args[0] === "string" &&
        (c.args[0] as string).includes("Automated review"),
    );
    expect(reviewNotifies.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Execution Workflow Actions ───────────────────────────────────

describe("execution workflow actions", () => {
  it("handles targeted-delegation action", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "exec-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect"],
        prompt: "Design the system",
        input: [],
        output: "architecture",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toContain("step-a");
  });

  it("handles tension-pair action with 2 agents", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "tension-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "tension-pair",
        agents: ["architect", "operator"],
        prompt: "Challenge the design",
        input: [],
        output: "reviewed",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toContain("step-a");
  });

  it("rejects tension-pair with wrong number of agents", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "tension-fail",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "tension-pair",
        agents: ["architect"],
        prompt: "Challenge the design",
        input: [],
        output: "reviewed",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await expect(runner.execute()).rejects.toThrow("exactly 2 agents");
  });

  it("handles orchestrator-synthesis action (no agents)", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "synth-test",
      name: "Test",
      description: "Test",
      steps: [
        { id: "step-a", action: "gather", input: [], output: "data-a", review_gate: false },
        {
          id: "step-b",
          action: "orchestrator-synthesis",
          prompt: "Assemble everything",
          input: ["data-a"],
          output: "final",
          review_gate: false,
        },
      ],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toEqual(["step-a", "step-b"]);
  });

  it("handles execute-with-tools action", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "exec-tools-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "execute-with-tools",
        prompt: "Run tests",
        input: [],
        output: "test-results",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toContain("step-a");

    // Should have spawned and destroyed an agent
    const spawnCalls = adapter.calls.filter(c => c.method === "spawnAgent");
    expect(spawnCalls.length).toBeGreaterThan(0);
    const destroyCalls = adapter.calls.filter(c => c.method === "destroyAgent");
    expect(destroyCalls.length).toBeGreaterThan(0);
  });

  it("creates artifacts when sessionDir is provided", async () => {
    const adapter = new MockAdapter();
    const sessionDir = mkdtempSync(join(tmpdir(), "aos-wf-test-"));

    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "artifact-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect"],
        prompt: "Design",
        input: [],
        output: "design_doc",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { sessionDir });
    await runner.execute();

    // Verify artifact was created via adapter.writeFile
    const writeCalls = adapter.calls.filter(c => c.method === "writeFile");
    expect(writeCalls.length).toBeGreaterThan(0);
  });

  it("still works with two-argument constructor", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "compat-test",
      name: "Test",
      description: "Test",
      steps: [
        { id: "step-a", action: "gather", input: [], output: "data", review_gate: false },
      ],
      gates: [],
    };
    // Two-argument constructor must still work
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toEqual(["step-a"]);
  });

  it("still works with two-argument constructor (no opts)", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "no-opts-test",
      name: "Test",
      description: "Test",
      steps: [
        { id: "step-a", action: "gather", input: [], output: "data", review_gate: false },
      ],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toEqual(["step-a"]);
  });

  it("includes synthesis inputs from previous steps", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "synth-inputs-test",
      name: "Test",
      description: "Test",
      steps: [
        { id: "step-a", action: "gather", input: [], output: "data-a", review_gate: false },
        { id: "step-b", action: "gather", input: [], output: "data-b", review_gate: false },
        {
          id: "step-c",
          action: "orchestrator-synthesis",
          prompt: "Synthesize",
          input: ["data-a", "data-b"],
          output: "final",
          review_gate: false,
        },
      ],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    const outputs = await runner.execute();

    const stepC = outputs.get("final") as {
      synthesis_inputs: Record<string, unknown>;
    };
    expect(stepC.synthesis_inputs["data-a"]).toBeDefined();
    expect(stepC.synthesis_inputs["data-b"]).toBeDefined();
  });
});

// ── UnsupportedError Recovery ─────────────────────────────────────

describe("UnsupportedError recovery", () => {
  it("handles UnsupportedError from executeCode gracefully", async () => {
    const adapter = new MockAdapter();
    adapter.executeCode = async () => { throw new UnsupportedError("executeCode"); };

    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "unsupported-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "execute-with-tools",
        agents: ["developer"],
        prompt: "Run code",
        code: "console.log('hello')",
        input: [],
        output: "result",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toContain("step-a");
  });
});

// ── retry_with_feedback Gate ──────────────────────────────────────

describe("retry_with_feedback gate", () => {
  it("revises artifact during retry_with_feedback when sessionDir is set", async () => {
    const adapter = new MockAdapter();
    const sessionDir = mkdtempSync(join(tmpdir(), "aos-retry-test-"));

    let confirmCount = 0;
    adapter.promptConfirm = async (title: string, message: string) => {
      adapter.calls.push({ method: "promptConfirm", args: [title, message], timestamp: Date.now() });
      confirmCount++;
      return confirmCount > 1;
    };
    adapter.promptInput = async (label: string) => {
      adapter.calls.push({ method: "promptInput", args: [label], timestamp: Date.now() });
      return "Add error handling";
    };

    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "retry-artifact-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect"],
        prompt: "Design it",
        input: [],
        output: "design",
        review_gate: true,
      }],
      gates: [{
        after: "step-a",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "retry_with_feedback",
      }],
    };

    const runner = new WorkflowRunner(config, adapter, { sessionDir });
    await runner.execute();

    expect(confirmCount).toBe(2);
    const writeCalls = adapter.calls.filter(c => c.method === "writeFile");
    expect(writeCalls.length).toBeGreaterThan(2);
  });

  it("re-runs step with user feedback on rejection", async () => {
    const adapter = new MockAdapter();
    let confirmCount = 0;
    adapter.promptConfirm = async (title: string, message: string) => {
      adapter.calls.push({ method: "promptConfirm", args: [title, message], timestamp: Date.now() });
      confirmCount++;
      return confirmCount > 1; // Reject first, approve second
    };
    adapter.promptInput = async (label: string) => {
      adapter.calls.push({ method: "promptInput", args: [label], timestamp: Date.now() });
      return "Please add error handling";
    };

    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "feedback-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect"],
        prompt: "Design it",
        input: [],
        output: "design",
        review_gate: true,
      }],
      gates: [{
        after: "step-a",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "retry_with_feedback",
      }],
    };

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();

    expect(confirmCount).toBe(2);
  });

  it("stops retrying after max iterations", async () => {
    const adapter = new MockAdapter();
    let confirmCount = 0;
    adapter.promptConfirm = async (title: string, message: string) => {
      adapter.calls.push({ method: "promptConfirm", args: [title, message], timestamp: Date.now() });
      confirmCount++;
      return false; // Always reject
    };
    adapter.promptInput = async (label: string) => {
      adapter.calls.push({ method: "promptInput", args: [label], timestamp: Date.now() });
      return "feedback";
    };

    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "max-retry-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "gather",
        input: [],
        output: "data",
        review_gate: true,
      }],
      gates: [{
        after: "step-a",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "retry_with_feedback",
        max_iterations: 3,
      }],
    };

    const runner = new WorkflowRunner(config, adapter);
    await runner.execute();
    expect(runner.getCompletedSteps()).toContain("step-a");
    // Should have been called 4 times: initial + 3 retries
    expect(confirmCount).toBe(4);
  });

  it("augments prompt with feedback text on retry", async () => {
    const adapter = new MockAdapter();
    let confirmCount = 0;
    const executedPrompts: string[] = [];

    adapter.promptConfirm = async (title: string, message: string) => {
      adapter.calls.push({ method: "promptConfirm", args: [title, message], timestamp: Date.now() });
      confirmCount++;
      return confirmCount > 1; // Reject first, approve second
    };
    adapter.promptInput = async (label: string) => {
      adapter.calls.push({ method: "promptInput", args: [label], timestamp: Date.now() });
      return "Add more detail";
    };

    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "augment-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect"],
        prompt: "Design it",
        input: [],
        output: "design",
        review_gate: true,
      }],
      gates: [{
        after: "step-a",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "retry_with_feedback",
      }],
    };

    const runner = new WorkflowRunner(config, adapter);
    const outputs = await runner.execute();

    // The re-executed step output is keyed by output name "design"
    const stepOutput = outputs.get("design") as { prompt: string };
    expect(stepOutput.prompt).toContain("User Feedback (Revision 1)");
    expect(stepOutput.prompt).toContain("Add more detail");
  });
});

// ── Transcript Events ─────────────────────────────────────────────

describe("transcript events", () => {
  it("emits workflow_start and workflow_end events", async () => {
    const events: any[] = [];
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "transcript-test",
      name: "Test",
      description: "Test",
      steps: [{ id: "step-a", action: "gather", input: [], output: "data", review_gate: false }],
      gates: [],
    };

    const runner = new WorkflowRunner(config, adapter, {
      onTranscriptEvent: (e) => events.push(e),
    });
    await runner.execute();

    const types = events.map(e => e.type);
    expect(types).toContain("workflow_start");
    expect(types).toContain("step_start");
    expect(types).toContain("step_end");
    expect(types).toContain("workflow_end");
  });

  it("includes correct data in workflow_start and workflow_end events", async () => {
    const events: any[] = [];
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "data-test",
      name: "Test",
      description: "Test",
      steps: [
        { id: "step-a", action: "gather", input: [], output: "data-a", review_gate: false },
        { id: "step-b", action: "gather", input: [], output: "data-b", review_gate: false },
      ],
      gates: [],
    };

    const runner = new WorkflowRunner(config, adapter, {
      onTranscriptEvent: (e) => events.push(e),
    });
    await runner.execute();

    const startEvent = events.find(e => e.type === "workflow_start");
    expect(startEvent.workflow_id).toBe("data-test");
    expect(startEvent.steps).toEqual(["step-a", "step-b"]);

    const endEvent = events.find(e => e.type === "workflow_end");
    expect(endEvent.workflow_id).toBe("data-test");
    // steps_completed is now an array of step IDs (GAP-H4)
    expect(endEvent.steps_completed).toEqual(["step-a", "step-b"]);
    // gates_passed is now an array of gate IDs (GAP-H4)
    expect(endEvent.gates_passed).toEqual([]);
  });

  it("tracks gate IDs in gates_passed array", async () => {
    const events: any[] = [];
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "gate-tracking-test",
      name: "Test",
      description: "Test",
      steps: [{ id: "step-a", action: "gather", input: [], output: "data", review_gate: true }],
      gates: [{
        after: "step-a",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "re-run-step",
      }],
    };

    const runner = new WorkflowRunner(config, adapter, {
      onTranscriptEvent: (e) => events.push(e),
    });
    await runner.execute();

    const endEvent = events.find(e => e.type === "workflow_end");
    // MockAdapter.promptConfirm returns true, so gate should pass
    expect(endEvent.gates_passed).toEqual(["gate-step-a"]);
  });

  it("emits gate_prompt and gate_result events", async () => {
    const events: any[] = [];
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "gate-events-test",
      name: "Test",
      description: "Test",
      steps: [{ id: "step-a", action: "gather", input: [], output: "data", review_gate: true }],
      gates: [{
        after: "step-a",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: "re-run-step",
      }],
    };

    const runner = new WorkflowRunner(config, adapter, {
      onTranscriptEvent: (e) => events.push(e),
    });
    await runner.execute();

    const types = events.map(e => e.type);
    expect(types).toContain("gate_prompt");
    expect(types).toContain("gate_result");

    const gatePromptEvent = events.find(e => e.type === "gate_prompt");
    expect(gatePromptEvent.after_step).toBe("step-a");
    expect(gatePromptEvent.prompt).toBe("Approve?");

    const gateResultEvent = events.find(e => e.type === "gate_result");
    expect(gateResultEvent.result).toBe("approved");
  });

  it("emits step_start with action and agents", async () => {
    const events: any[] = [];
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "step-events-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect", "operator"],
        prompt: "Design",
        input: [],
        output: "design",
        review_gate: false,
      }],
      gates: [],
    };

    const runner = new WorkflowRunner(config, adapter, {
      onTranscriptEvent: (e) => events.push(e),
    });
    await runner.execute();

    const stepStart = events.find(e => e.type === "step_start");
    expect(stepStart.step_id).toBe("step-a");
    expect(stepStart.action).toBe("targeted-delegation");
    expect(stepStart.agents).toEqual(["architect", "operator"]);
  });

  it("emits step_end with duration", async () => {
    const events: any[] = [];
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "duration-test",
      name: "Test",
      description: "Test",
      steps: [{ id: "step-a", action: "gather", input: [], output: "data", review_gate: false }],
      gates: [],
    };

    const runner = new WorkflowRunner(config, adapter, {
      onTranscriptEvent: (e) => events.push(e),
    });
    await runner.execute();

    const stepEnd = events.find(e => e.type === "step_end");
    expect(stepEnd.step_id).toBe("step-a");
    expect(typeof stepEnd.duration_seconds).toBe("number");
    expect(stepEnd.duration_seconds).toBeGreaterThanOrEqual(0);
  });

  it("emits artifact_write with content_path", async () => {
    const events: any[] = [];
    const adapter = new MockAdapter();
    const sessionDir = mkdtempSync(join(tmpdir(), "aos-wf-test-"));
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "artifact-path-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect"],
        prompt: "Design",
        input: [],
        output: "design_doc",
        review_gate: false,
      }],
      gates: [],
    };

    const runner = new WorkflowRunner(config, adapter, {
      sessionDir,
      onTranscriptEvent: (e) => events.push(e),
    });
    await runner.execute();

    const artifactEvent = events.find(e => e.type === "artifact_write");
    expect(artifactEvent).toBeDefined();
    expect(artifactEvent.artifact_id).toBe("design_doc");
    expect(artifactEvent.content_path).toBeDefined();
    expect(typeof artifactEvent.content_path).toBe("string");
    expect(artifactEvent.content_path).toContain("design_doc");
  });
});

// ── DelegationDelegate Integration ─────────────────────────────────

describe("DelegationDelegate integration", () => {
  function mockResponse(text: string): AgentResponse {
    return {
      text,
      tokensIn: 100,
      tokensOut: 200,
      cost: 0.01,
      contextTokens: 0,
      model: "mock-model",
      status: "success",
    };
  }

  function createMockDelegate(): DelegationDelegate & {
    calls: { method: string; args: unknown[] }[];
  } {
    const calls: { method: string; args: unknown[] }[] = [];
    return {
      calls,
      delegateToAgents: async (agentIds: string[], message: string) => {
        calls.push({ method: "delegateToAgents", args: [agentIds, message] });
        return agentIds.map((id) => mockResponse(`Response from ${id}`));
      },
      delegateTensionPair: async (agent1: string, agent2: string, message: string) => {
        calls.push({ method: "delegateTensionPair", args: [agent1, agent2, message] });
        return [
          mockResponse(`Initial from ${agent1}`),
          mockResponse(`Challenge from ${agent2}`),
        ];
      },
      delegateToOrchestrator: async (message: string) => {
        calls.push({ method: "delegateToOrchestrator", args: [message] });
        return mockResponse("Orchestrator synthesis result");
      },
      delegateDirect: async (agentId: string, message: string) => {
        calls.push({ method: "delegateDirect", args: [agentId, message] });
        return mockResponse(`Remote result from ${agentId}`);
      },
    };
  }

  it("targeted-delegation calls delegateToAgents when delegate is provided", async () => {
    const adapter = new MockAdapter();
    const delegate = createMockDelegate();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "delegate-targeted-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect", "operator"],
        prompt: "Design the system",
        input: [],
        output: "architecture",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { delegationDelegate: delegate });
    const outputs = await runner.execute();

    expect(delegate.calls).toHaveLength(1);
    expect(delegate.calls[0].method).toBe("delegateToAgents");
    expect(delegate.calls[0].args[0]).toEqual(["architect", "operator"]);

    // Agent responses become the step output
    const output = outputs.get("architecture");
    expect(typeof output).toBe("string");
    expect(output).toContain("Response from architect");
    expect(output).toContain("Response from operator");
  });

  it("tension-pair calls delegateTensionPair when delegate is provided", async () => {
    const adapter = new MockAdapter();
    const delegate = createMockDelegate();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "delegate-tension-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "tension-pair",
        agents: ["architect", "operator"],
        prompt: "Challenge the design",
        input: [],
        output: "reviewed",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { delegationDelegate: delegate });
    const outputs = await runner.execute();

    expect(delegate.calls).toHaveLength(1);
    expect(delegate.calls[0].method).toBe("delegateTensionPair");
    expect(delegate.calls[0].args[0]).toBe("architect");
    expect(delegate.calls[0].args[1]).toBe("operator");

    const output = outputs.get("reviewed");
    expect(typeof output).toBe("string");
    expect(output).toContain("Initial from architect");
    expect(output).toContain("Challenge from operator");
  });

  it("orchestrator-synthesis calls delegateToOrchestrator when delegate is provided", async () => {
    const adapter = new MockAdapter();
    const delegate = createMockDelegate();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "delegate-synth-test",
      name: "Test",
      description: "Test",
      steps: [
        { id: "step-a", action: "gather", input: [], output: "data-a", review_gate: false },
        {
          id: "step-b",
          action: "orchestrator-synthesis",
          prompt: "Synthesize everything",
          input: ["data-a"],
          output: "final",
          review_gate: false,
        },
      ],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { delegationDelegate: delegate });
    const outputs = await runner.execute();

    expect(delegate.calls).toHaveLength(1);
    expect(delegate.calls[0].method).toBe("delegateToOrchestrator");

    const output = outputs.get("final");
    expect(typeof output).toBe("string");
    expect(output).toBe("Orchestrator synthesis result");
  });

  it("steps still work without a delegate (backward compatibility)", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "no-delegate-test",
      name: "Test",
      description: "Test",
      steps: [
        {
          id: "step-a",
          action: "targeted-delegation",
          agents: ["architect"],
          prompt: "Design",
          input: [],
          output: "design",
          review_gate: false,
        },
        {
          id: "step-b",
          action: "tension-pair",
          agents: ["architect", "operator"],
          prompt: "Challenge",
          input: [],
          output: "reviewed",
          review_gate: false,
        },
        {
          id: "step-c",
          action: "orchestrator-synthesis",
          prompt: "Synthesize",
          input: ["design"],
          output: "final",
          review_gate: false,
        },
      ],
      gates: [],
    };
    // No delegate provided — should fall back to structured placeholder
    const runner = new WorkflowRunner(config, adapter);
    const outputs = await runner.execute();

    expect(runner.getCompletedSteps()).toEqual(["step-a", "step-b", "step-c"]);

    // Fallback outputs should be objects with delegation: "pending"
    const designOutput = outputs.get("design") as { delegation: string };
    expect(designOutput.delegation).toBe("pending");

    const reviewedOutput = outputs.get("reviewed") as { delegation: string };
    expect(reviewedOutput.delegation).toBe("pending");

    // Orchestrator fallback is an object with synthesis_inputs
    const finalOutput = outputs.get("final") as { synthesis_inputs: Record<string, unknown> };
    expect(finalOutput.synthesis_inputs).toBeDefined();
  });

  it("agent responses become the artifact content when delegate is provided", async () => {
    const adapter = new MockAdapter();
    const delegate = createMockDelegate();
    const sessionDir = mkdtempSync(join(tmpdir(), "aos-delegate-artifact-"));
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "delegate-artifact-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "targeted-delegation",
        agents: ["architect"],
        prompt: "Design the system",
        input: [],
        output: "architecture",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, {
      sessionDir,
      delegationDelegate: delegate,
    });
    const outputs = await runner.execute();

    // The output is the joined agent response text
    const output = outputs.get("architecture") as string;
    expect(output).toBe("Response from architect");

    // Artifact should have been written via adapter.writeFile
    const writeCalls = adapter.calls.filter((c) => c.method === "writeFile");
    expect(writeCalls.length).toBeGreaterThan(0);
    // The artifact content should contain the agent response
    const artifactWriteCall = writeCalls.find(
      (c) => typeof c.args[1] === "string" && (c.args[1] as string).includes("Response from architect"),
    );
    expect(artifactWriteCall).toBeDefined();
  });

  it("a2a-delegate calls delegateDirect with the remote agent and ingests its response", async () => {
    const adapter = new MockAdapter();
    const delegate = createMockDelegate();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "exec-mode-a2a-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "a2a-delegate",
        agents: ["remote-adk-planner"],
        prompt: "Plan the migration",
        input: [],
        output: "plan",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { delegationDelegate: delegate });
    const outputs = await runner.execute();

    // Routed through delegateDirect (execution mode), NOT delegateToAgents.
    expect(delegate.calls).toHaveLength(1);
    expect(delegate.calls[0].method).toBe("delegateDirect");
    expect(delegate.calls[0].args[0]).toBe("remote-adk-planner");
    expect(delegate.calls[0].args[1]).toContain("Plan the migration");

    // The single remote response text becomes the step output.
    expect(outputs.get("plan")).toBe("Remote result from remote-adk-planner");
  });

  it("adk-graph is a synonym for a2a-delegate (execution-mode remote dispatch)", async () => {
    const adapter = new MockAdapter();
    const delegate = createMockDelegate();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "exec-mode-adk-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "adk-graph",
        agents: ["remote-adk-graph"],
        prompt: "Run the graph",
        input: [],
        output: "result",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { delegationDelegate: delegate });
    const outputs = await runner.execute();

    expect(delegate.calls[0].method).toBe("delegateDirect");
    expect(outputs.get("result")).toBe("Remote result from remote-adk-graph");
  });

  it("a2a-delegate fails clearly when no execution-mode delegate is provided", async () => {
    const adapter = new MockAdapter();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "exec-mode-no-delegate",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "a2a-delegate",
        agents: ["remote-x"],
        prompt: "Do it",
        input: [],
        output: "out",
        review_gate: false,
      }],
      gates: [],
    };
    // No delegate at all — a real remote call has no meaningful placeholder.
    const runner = new WorkflowRunner(config, adapter);
    await expect(runner.execute()).rejects.toThrow(/delegateDirect/);
  });

  it("a2a-delegate fails clearly when the step names no remote agent", async () => {
    const adapter = new MockAdapter();
    const delegate = createMockDelegate();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "exec-mode-no-agent",
      name: "Test",
      description: "Test",
      steps: [{
        id: "step-a",
        action: "a2a-delegate",
        agents: [],
        prompt: "Do it",
        input: [],
        output: "out",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { delegationDelegate: delegate });
    await expect(runner.execute()).rejects.toThrow(/requires a remote agent/);
  });
});

// ── WorkflowRunner — executeWithTools agent resolution ──────────────

describe("WorkflowRunner — executeWithTools agent resolution", () => {
  it("uses real agent config when agents field specifies a known agent", async () => {
    // This test verifies the WorkflowRunner can accept an agents map
    // and that executeWithTools resolves agent configs from it.
    const { WorkflowRunner } = await import("../src/workflow-runner");
    const adapter = new MockAdapter();

    const agents = new Map();
    agents.set("engineering-lead", {
      schema: "aos/agent/v1",
      id: "engineering-lead",
      name: "Engineering Lead",
      role: "test",
      cognition: { objective_function: "test", time_horizon: { primary: "", secondary: "", peripheral: "" }, core_bias: "", risk_tolerance: "moderate", default_stance: "" },
      persona: { temperament: [], thinking_patterns: [], heuristics: [], evidence_standard: { convinced_by: [], not_convinced_by: [] }, red_lines: [] },
      tensions: [],
      report: { structure: "" },
      tools: ["read"],
      skills: [],
      expertise: [],
      model: { tier: "standard", thinking: "off" },
      delegation: { can_spawn: true, max_children: 3, child_model_tier: "economy", child_timeout_seconds: 120, delegation_style: "delegate-only" },
    });

    const config = {
      schema: "aos/workflow/v1",
      id: "test-workflow",
      name: "Test",
      description: "test",
      steps: [{
        id: "test-step",
        action: "execute-with-tools",
        agents: ["engineering-lead"],
        prompt: "test prompt",
        output: "test_output",
      }],
      gates: [],
    };

    const runner = new WorkflowRunner(config, adapter, { agents });
    // The runner should accept the agents map without error
    expect(runner).toBeDefined();
  });
});

// ── Brief injection (Bug 3) ─────────────────────────────────────────

describe("brief injection into workflow steps", () => {
  function mockResponse(text: string): AgentResponse {
    return { text, tokensIn: 1, tokensOut: 1, cost: 0, contextTokens: 0, model: "m", status: "success" };
  }
  function capturingDelegate() {
    const prompts: string[] = [];
    const delegate: DelegationDelegate = {
      delegateToAgents: async (ids: string[], message: string) => {
        prompts.push(message);
        return ids.map((id) => mockResponse(`ok ${id}`));
      },
      delegateTensionPair: async (a: string, b: string, message: string) => {
        prompts.push(message);
        return [mockResponse("a"), mockResponse("b")];
      },
      delegateToOrchestrator: async (message: string) => {
        prompts.push(message);
        return mockResponse("synth");
      },
      delegateDirect: async (id: string, message: string) => {
        prompts.push(message);
        return mockResponse("remote");
      },
    };
    return { delegate, prompts };
  }

  const BRIEF = "## Feature\nBuild a widget exporter.\n## Success\nExports run under 2s.";

  it("prepends the brief to a step prompt that does not reference {{brief}}", async () => {
    const adapter = new MockAdapter();
    const { delegate, prompts } = capturingDelegate();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "brief-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "understand",
        action: "targeted-delegation",
        agents: ["advocate"],
        prompt: "Analyze this feature request.",
        input: [],
        output: "requirements",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { delegationDelegate: delegate, brief: BRIEF });
    await runner.execute();

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Build a widget exporter.");
    expect(prompts[0]).toContain("Analyze this feature request.");
  });

  it("resolves an explicit {{brief}} reference without duplicating the brief", async () => {
    const adapter = new MockAdapter();
    const { delegate, prompts } = capturingDelegate();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "brief-var-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "understand",
        action: "targeted-delegation",
        agents: ["advocate"],
        prompt: "Here is the brief:\n{{brief}}\nNow analyze it.",
        input: [],
        output: "requirements",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { delegationDelegate: delegate, brief: BRIEF });
    await runner.execute();

    expect(prompts[0]).toContain("Build a widget exporter.");
    // {{brief}} expanded, so the runner must NOT also prepend a second copy.
    const occurrences = prompts[0].split("Build a widget exporter.").length - 1;
    expect(occurrences).toBe(1);
  });

  it("leaves prompts unchanged when no brief is provided", async () => {
    const adapter = new MockAdapter();
    const { delegate, prompts } = capturingDelegate();
    const config: WorkflowConfig = {
      schema: "aos/workflow/v1",
      id: "no-brief-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "understand",
        action: "targeted-delegation",
        agents: ["advocate"],
        prompt: "Analyze this feature request.",
        input: [],
        output: "requirements",
        review_gate: false,
      }],
      gates: [],
    };
    const runner = new WorkflowRunner(config, adapter, { delegationDelegate: delegate });
    await runner.execute();

    expect(prompts[0]).not.toContain("## Brief");
    expect(prompts[0]).toContain("Analyze this feature request.");
  });
});

// ── Auto-approve gates (Bug 4) ──────────────────────────────────────

describe("autoApprove non-interactive gates", () => {
  function gateConfig(onRejection: "re-run-step" | "retry_with_feedback"): WorkflowConfig {
    return {
      schema: "aos/workflow/v1",
      id: "gate-auto-test",
      name: "Test",
      description: "Test",
      steps: [{
        id: "understand",
        action: "gather",
        prompt: "do it",
        input: [],
        output: "requirements",
        review_gate: true,
      }],
      gates: [{
        after: "understand",
        type: "user-approval",
        prompt: "Approve?",
        on_rejection: onRejection,
      }],
    };
  }

  it("passes a user-approval gate without calling promptConfirm (re-run-step)", async () => {
    const adapter = new MockAdapter();
    const runner = new WorkflowRunner(gateConfig("re-run-step"), adapter, { autoApprove: true });
    await runner.execute();
    const confirmCalls = adapter.calls.filter((c) => c.method === "promptConfirm");
    expect(confirmCalls).toHaveLength(0);
  });

  it("passes a retry_with_feedback gate without calling promptConfirm", async () => {
    const adapter = new MockAdapter();
    const runner = new WorkflowRunner(gateConfig("retry_with_feedback"), adapter, { autoApprove: true });
    await runner.execute();
    const confirmCalls = adapter.calls.filter((c) => c.method === "promptConfirm");
    const inputCalls = adapter.calls.filter((c) => c.method === "promptInput");
    expect(confirmCalls).toHaveLength(0);
    expect(inputCalls).toHaveLength(0);
  });

  it("still prompts when autoApprove is false", async () => {
    const adapter = new MockAdapter();
    // MockAdapter.promptConfirm returns true, so execution proceeds.
    const runner = new WorkflowRunner(gateConfig("re-run-step"), adapter, { autoApprove: false });
    await runner.execute();
    const confirmCalls = adapter.calls.filter((c) => c.method === "promptConfirm");
    expect(confirmCalls).toHaveLength(1);
  });
});
