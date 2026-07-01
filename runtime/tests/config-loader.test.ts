import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { loadAgent, loadProfile, loadDomain, loadWorkflow, loadSkill, resolveWorkflowFile, validateBrief } from "../src/config-loader";

const fixturesDir = join(import.meta.dir, "..", "fixtures");
const coreWorkflowsDir = join(import.meta.dir, "..", "..", "core", "workflows");

describe("loadAgent", () => {
  it("loads a valid agent from yaml + prompt.md", () => {
    const agent = loadAgent(join(fixturesDir, "agents", "catalyst"));
    expect(agent.id).toBe("catalyst");
    expect(agent.name).toBe("Catalyst");
    expect(agent.cognition.core_bias).toBe("speed-and-monetization");
    expect(agent.persona.heuristics).toHaveLength(2);
    expect(agent.systemPrompt).toContain("{{session_id}}");
  });

  it("throws on missing agent.yaml", () => {
    expect(() => loadAgent("/nonexistent/path")).toThrow();
  });

  it("validates schema field", () => {
    const agent = loadAgent(join(fixturesDir, "agents", "catalyst"));
    expect(agent.schema).toBe("aos/agent/v1");
  });

  it("loads agent with capabilities field", () => {
    const agent = loadAgent(join(fixturesDir, "agents", "capable-agent"));
    expect(agent.id).toBe("capable-agent");
    expect(agent.name).toBe("Capable Agent");
    expect(agent.capabilities).toBeDefined();
    expect(agent.capabilities!.can_execute_code).toBe(true);
    expect(agent.capabilities!.can_produce_files).toBe(true);
    expect(agent.capabilities!.can_review_artifacts).toBe(true);
    expect(agent.capabilities!.available_skills).toEqual(["code-review", "testing"]);
    expect(agent.capabilities!.output_types).toEqual(["text", "markdown", "code", "structured-data"]);
  });

  it("loads agent without capabilities (defaults to undefined)", () => {
    const agent = loadAgent(join(fixturesDir, "agents", "catalyst"));
    expect(agent.capabilities).toBeUndefined();
  });
});

describe("loadProfile", () => {
  it("loads a valid profile", () => {
    const profile = loadProfile(join(fixturesDir, "profiles", "test-council"));
    expect(profile.id).toBe("test-council");
    expect(profile.constraints.time.max_minutes).toBe(5);
    expect(profile.assembly.perspectives).toHaveLength(1);
    expect(profile.runtime_requirements).toEqual({
      serve: false,
      channels: false,
      mempalace: false,
      a2a_serve: false,
    });
  });

  it("throws on missing profile.yaml", () => {
    expect(() => loadProfile("/nonexistent/path")).toThrow();
  });
});

describe("loadDomain", () => {
  it("loads a valid domain", () => {
    const domain = loadDomain(join(fixturesDir, "domains", "test-domain"));
    expect(domain.id).toBe("test-domain");
    expect(domain.overlays.catalyst).toBeDefined();
    expect(domain.overlays.catalyst.thinking_patterns).toHaveLength(1);
  });

  it("throws on missing domain.yaml", () => {
    expect(() => loadDomain("/nonexistent/path")).toThrow();
  });
});

describe("loadWorkflow — execution workflow", () => {
  const execWorkflowDir = join(fixturesDir, "workflows", "execution-workflow");

  it("loads execution-workflow fixture with new action types", () => {
    const wf = loadWorkflow(execWorkflowDir);
    expect(wf.id).toBe("execution-workflow");
    expect(wf.steps).toHaveLength(4);
    expect(wf.steps[0].action).toBe("targeted-delegation");
    expect(wf.steps[2].action).toBe("tension-pair");
    expect(wf.steps[3].action).toBe("orchestrator-synthesis");
  });

  it("accepts retry_with_feedback as on_rejection value", () => {
    const wf = loadWorkflow(execWorkflowDir);
    expect(wf.gates[0].on_rejection).toBe("retry_with_feedback");
    expect(wf.gates[1].on_rejection).toBe("retry_with_feedback");
  });

  it("tension-pair step has exactly 2 agents", () => {
    const wf = loadWorkflow(execWorkflowDir);
    const tensionStep = wf.steps.find((s) => s.action === "tension-pair");
    expect(tensionStep).toBeDefined();
    expect(tensionStep!.agents).toHaveLength(2);
  });

  it("rejects tension-pair step without exactly 2 agents", () => {
    const tmpDir = join(fixturesDir, "workflows", "_tmp-tension-invalid");
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(
        join(tmpDir, "workflow.yaml"),
        `schema: aos/workflow/v1
id: bad-tension
name: Bad Tension
steps:
  - id: review
    action: tension-pair
    agents: [only-one]
    input: []
    output: review_output
    review_gate: false
gates: []
`,
      );
      expect(() => loadWorkflow(tmpDir)).toThrow("exactly 2 agents");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates artifact ID uniqueness", () => {
    const tmpDir = join(fixturesDir, "workflows", "_tmp-dup-output");
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(
        join(tmpDir, "workflow.yaml"),
        `schema: aos/workflow/v1
id: dup-output
name: Dup Output
steps:
  - id: step-a
    action: gather
    input: []
    output: same_output
    review_gate: false
  - id: step-b
    action: process
    input: []
    output: same_output
    review_gate: false
gates: []
`,
      );
      expect(() => loadWorkflow(tmpDir)).toThrow("Duplicate artifact output ID");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("resolves input references by output ID", () => {
    const wf = loadWorkflow(execWorkflowDir);
    // design step references requirements_analysis (an output ID, not a step ID)
    const designStep = wf.steps.find((s) => s.id === "design");
    expect(designStep!.input).toContain("requirements_analysis");
  });

  it("resolves input references by step ID (backward compatibility)", () => {
    const wf = loadWorkflow(join(fixturesDir, "workflows", "test-workflow"));
    // test-workflow uses step IDs as input references
    const stepTwo = wf.steps.find((s) => s.id === "step-two");
    expect(stepTwo!.input).toContain("step-one");
  });

  it("rejects unknown input references", () => {
    const tmpDir = join(fixturesDir, "workflows", "_tmp-bad-input");
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(
        join(tmpDir, "workflow.yaml"),
        `schema: aos/workflow/v1
id: bad-input
name: Bad Input
steps:
  - id: step-a
    action: gather
    input: [nonexistent_ref]
    output: data
    review_gate: false
gates: []
`,
      );
      expect(() => loadWorkflow(tmpDir)).toThrow('references unknown input "nonexistent_ref"');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates gate after references a step with review_gate: true", () => {
    const tmpDir = join(fixturesDir, "workflows", "_tmp-bad-gate");
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(
        join(tmpDir, "workflow.yaml"),
        `schema: aos/workflow/v1
id: bad-gate
name: Bad Gate
steps:
  - id: step-a
    action: gather
    input: []
    output: data
    review_gate: false
gates:
  - after: step-a
    type: user-approval
    prompt: "Approve?"
`,
      );
      expect(() => loadWorkflow(tmpDir)).toThrow("without review_gate: true");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects forward references (step B references step C output but C comes after B)", () => {
    const tmpDir = join(fixturesDir, "workflows", "_tmp-forward-ref");
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(
        join(tmpDir, "workflow.yaml"),
        `schema: aos/workflow/v1
id: forward-ref
name: Forward Reference
steps:
  - id: step-a
    action: gather
    input: []
    output: data_a
    review_gate: false
  - id: step-b
    action: process
    input: [data_c]
    output: data_b
    review_gate: false
  - id: step-c
    action: process
    input: [data_a]
    output: data_c
    review_gate: false
gates: []
`,
      );
      expect(() => loadWorkflow(tmpDir)).toThrow('forward reference to "data_c"');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("validateId rejection", () => {
  it("rejects agent IDs with uppercase characters", () => {
    const tmpDir = join(fixturesDir, "agents", "_tmp-bad-id");
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(
        join(tmpDir, "agent.yaml"),
        `schema: aos/agent/v1
id: BadAgent
name: Bad Agent
role: Test role
model:
  tier: standard
  thinking: "off"
cognition:
  objective_function: test
  time_horizon:
    primary: short
    secondary: medium
    peripheral: long
  core_bias: none
  risk_tolerance: moderate
  default_stance: neutral
persona:
  temperament: []
  thinking_patterns: []
  heuristics: []
  evidence_standard:
    convinced_by: []
    not_convinced_by: []
  red_lines: []
output:
  format: memo
  required_sections: []
`,
      );
      writeFileSync(join(tmpDir, "prompt.md"), "System prompt here");
      expect(() => loadAgent(tmpDir)).toThrow("Invalid ID");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("loadProfile — workflow field", () => {
  it("loads profile with workflow field", () => {
    const profile = loadProfile(join(fixturesDir, "profiles", "workflow-council"));
    expect(profile.id).toBe("workflow-council");
    expect(profile.workflow).toBe("execution-workflow");
  });

  it("loads profile with role_override on perspectives", () => {
    const profile = loadProfile(join(fixturesDir, "profiles", "workflow-council"));
    expect(profile.assembly.perspectives[0].role_override).toBe("lead analyst");
  });

  it("defaults workflow to null when not specified", () => {
    const profile = loadProfile(join(fixturesDir, "profiles", "test-council"));
    expect(profile.workflow).toBeNull();
  });

  it("defaults role_override to null when not specified", () => {
    const profile = loadProfile(join(fixturesDir, "profiles", "test-council"));
    expect(profile.assembly.perspectives[0].role_override).toBeNull();
  });
});

describe("loadSkill", () => {
  it("loads the test-skill fixture", () => {
    const skill = loadSkill(join(fixturesDir, "skills", "test-skill"));
    expect(skill.schema).toBe("aos/skill/v1");
    expect(skill.id).toBe("test-skill");
    expect(skill.name).toBe("Test Skill");
    expect(skill.version).toBe("0.1.0");
    expect(skill.input.required).toHaveLength(1);
    expect(skill.input.required![0].id).toBe("source");
    expect(skill.input.required![0].type).toBe("text");
    expect(skill.output.structured_result).toBe(false);
    expect(skill.compatible_agents).toEqual(["operator"]);
  });

  it("loads the code-review skill from core/skills", () => {
    const coreSkillsDir = join(fixturesDir, "..", "..", "core", "skills");
    const skill = loadSkill(join(coreSkillsDir, "code-review"));
    expect(skill.id).toBe("code-review");
    expect(skill.name).toBe("Code Review");
    expect(skill.version).toBe("1.0.0");
    expect(skill.input.required).toHaveLength(1);
    expect(skill.input.optional).toHaveLength(2);
    expect(skill.output.structured_result).toBe(true);
    expect(skill.compatible_agents).toEqual(["sentinel", "architect", "operator"]);
    expect(skill.platform_bindings!["claude-code"]).toBe("superpowers:requesting-code-review");
    expect(skill.platform_requirements!.requires_file_access).toBe(true);
  });

  it("loads the security-scan skill from core/skills", () => {
    const coreSkillsDir = join(fixturesDir, "..", "..", "core", "skills");
    const skill = loadSkill(join(coreSkillsDir, "security-scan"));
    expect(skill.id).toBe("security-scan");
    expect(skill.name).toBe("Security Scan");
    expect(skill.compatible_agents).toEqual(["sentinel", "steward"]);
    expect(skill.platform_bindings!["claude-code"]).toBe("scan");
  });

  it("throws on missing skill.yaml", () => {
    expect(() => loadSkill("/nonexistent/path")).toThrow("skill.yaml not found");
  });

  it("validates schema version", () => {
    const tmpDir = join(fixturesDir, "skills", "_tmp-bad-schema");
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(
        join(tmpDir, "skill.yaml"),
        `schema: aos/skill/v99
id: bad-skill
name: Bad Skill
description: "A skill with wrong schema"
version: 1.0.0
input:
  required: []
output:
  artifacts: []
`,
      );
      expect(() => loadSkill(tmpDir)).toThrow('expected "aos/skill/v1"');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates skill ID format", () => {
    const tmpDir = join(fixturesDir, "skills", "_tmp-bad-id");
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(
        join(tmpDir, "skill.yaml"),
        `schema: aos/skill/v1
id: BadSkill
name: Bad Skill
description: "A skill with invalid ID"
version: 1.0.0
input:
  required: []
output:
  artifacts: []
`,
      );
      expect(() => loadSkill(tmpDir)).toThrow("Invalid ID");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("validateBrief", () => {
  it("validates a brief with all required sections", () => {
    const briefPath = join(fixturesDir, "briefs", "test-brief", "brief.md");
    const requiredSections = [
      { heading: "## Situation", guidance: "" },
      { heading: "## Key Question", guidance: "" },
    ];
    const result = validateBrief(briefPath, requiredSections);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("reports missing sections", () => {
    const briefPath = join(fixturesDir, "briefs", "test-brief", "brief.md");
    const requiredSections = [
      { heading: "## Situation", guidance: "" },
      { heading: "## Stakes", guidance: "What's at risk?" },
      { heading: "## Key Question", guidance: "" },
    ];
    const result = validateBrief(briefPath, requiredSections);
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].heading).toBe("## Stakes");
  });
});

// ── resolveWorkflowFile (Bug 2: workflow resolution mismatch) ────────

describe("resolveWorkflowFile", () => {
  it("resolves a -workflow id to its flat <name>.workflow.yaml file", () => {
    // cto-execution profile declares `workflow: cto-execution-workflow`, but the
    // file on disk is the flat core/workflows/cto-execution.workflow.yaml.
    const resolved = resolveWorkflowFile(coreWorkflowsDir, "cto-execution-workflow");
    expect(resolved.endsWith("cto-execution.workflow.yaml")).toBe(true);
    // And it must actually load.
    expect(loadWorkflow(resolved).id).toBe("cto-execution-workflow");
  });

  it("resolves dev-execution-workflow to its flat file", () => {
    const resolved = resolveWorkflowFile(coreWorkflowsDir, "dev-execution-workflow");
    expect(resolved.endsWith("dev-execution.workflow.yaml")).toBe(true);
    expect(loadWorkflow(resolved).id).toBe("dev-execution-workflow");
  });

  it("resolves the directory convention (paperclip-worker/workflow.yaml)", () => {
    // paperclip-worker's profile declares `workflow: paperclip-worker`, resolved
    // via the directory convention; the file's own id is paperclip-worker-workflow.
    const resolved = resolveWorkflowFile(coreWorkflowsDir, "paperclip-worker");
    expect(resolved.endsWith(join("paperclip-worker", "workflow.yaml"))).toBe(true);
    expect(loadWorkflow(resolved).id).toBe("paperclip-worker-workflow");
  });

  it("throws a helpful error listing candidates for an unknown workflow", () => {
    expect(() => resolveWorkflowFile(coreWorkflowsDir, "does-not-exist")).toThrow(
      /not found \(tried:/,
    );
  });
});
