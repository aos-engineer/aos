/**
 * WorkflowRunner — loads and executes workflow definitions.
 *
 * Workflows are sequences of steps with optional gates (user-approval or
 * automated-review) that pause execution for human or automated review.
 *
 * The runner delegates actual work to the AOSAdapter — it is a framework
 * that interprets step actions and orchestrates the flow, not the executor.
 */

import type { AOSAdapter, AgentConfig, ExecuteCodeOpts, TranscriptEntry, ProfileConfig, DelegationDelegate } from "./types";
import { UnsupportedError } from "./types";
import { ArtifactManager } from "./artifact-manager";
import { resolveTemplate } from "./template-resolver";

// ── Workflow Config Types ──────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  name?: string;
  action: string;
  description?: string;
  agents?: string[];
  prompt?: string;
  /** Explicit code to execute for execute-with-tools steps (separate from prompt). */
  code?: string;
  structural_advantage?: "speaks-last" | null;
  input?: string[];
  output?: string;
  review_gate?: boolean;
  max_retries?: number;    // max retry loops for execute-with-tools steps
}

export interface WorkflowGate {
  after: string;
  type: "user-approval" | "automated-review";
  prompt: string;
  max_iterations?: number;
  on_rejection?: "re-run-step" | "retry_with_feedback";
}

export interface WorkflowConfig {
  schema: string;
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  gates: WorkflowGate[];
}

// ── Workflow Runner ────────────────────────────────────────────────

export class WorkflowRunner {
  private config: WorkflowConfig;
  private adapter: AOSAdapter;
  private stepOutputs: Map<string, unknown> = new Map();
  /** Maps step IDs to their output keys (step.output ?? step.id) for reverse lookup. */
  private stepIdToOutputKey: Map<string, string> = new Map();
  private completedSteps: string[] = [];
  private sessionDir?: string;
  private artifactManager?: ArtifactManager;
  private onTranscriptEvent?: (event: TranscriptEntry) => void;
  private gatesPassed: string[] = [];
  private profileConfig?: ProfileConfig;
  private delegationDelegate?: DelegationDelegate;
  private agents?: Map<string, AgentConfig>;
  /** The session brief, injected into every step's prompt as grounding context. */
  private brief: string = "";
  /** When true, `user-approval` gates auto-approve instead of prompting (aos run --yes). */
  private autoApprove: boolean = false;

  constructor(config: WorkflowConfig, adapter: AOSAdapter, opts?: {
    sessionDir?: string;
    onTranscriptEvent?: (event: TranscriptEntry) => void;
    profileConfig?: ProfileConfig;
    delegationDelegate?: DelegationDelegate;
    agents?: Map<string, AgentConfig>;
    brief?: string;
    autoApprove?: boolean;
  }) {
    this.config = config;
    this.adapter = adapter;
    if (opts?.sessionDir) {
      this.sessionDir = opts.sessionDir;
      this.artifactManager = new ArtifactManager(adapter, opts.sessionDir);
    }
    if (opts?.onTranscriptEvent) {
      this.onTranscriptEvent = opts.onTranscriptEvent;
    }
    if (opts?.profileConfig) {
      this.profileConfig = opts.profileConfig;
    }
    if (opts?.delegationDelegate) {
      this.delegationDelegate = opts.delegationDelegate;
    }
    if (opts?.agents) {
      this.agents = opts.agents;
    }
    if (opts?.brief) {
      this.brief = opts.brief;
    }
    this.autoApprove = opts?.autoApprove ?? false;
  }

  private emitEvent(event: TranscriptEntry): void {
    if (this.onTranscriptEvent) {
      this.onTranscriptEvent(event);
    }
  }

  /**
   * Build a template variables map for the given step, pulling from
   * workflow config, profile config, and step metadata.
   */
  private buildTemplateVars(step: WorkflowStep): Record<string, string> {
    const vars: Record<string, string> = {
      step_id: step.id,
      step_name: step.name ?? step.id,
      workflow_id: this.config.id,
      workflow_name: this.config.name,
      // The brief is the workflow's root input; expose it so any step prompt can
      // reference {{brief}} explicitly. resolveStepPrompt also prepends it as a
      // context block for steps that do not.
      brief: this.brief,
    };

    // Add agent names if available
    if (step.agents && step.agents.length > 0) {
      vars["agents"] = step.agents.join(", ");
      vars["agent"] = step.agents[0];
    }

    // Resolve role_override from profile context if available
    if (this.profileConfig && step.agents) {
      for (const agentId of step.agents) {
        const member = this.profileConfig.assembly?.perspectives?.find(
          (p) => p.agent === agentId,
        );
        if (member?.role_override) {
          vars["role_override"] = member.role_override;
          break; // Use the first agent's role_override
        }
      }
    }

    // Profile-level variables
    if (this.profileConfig) {
      vars["profile_id"] = this.profileConfig.id;
      vars["profile_name"] = this.profileConfig.name;
    }

    return vars;
  }

  /**
   * Resolve template variables in a step's prompt.
   */
  private resolveStepPrompt(step: WorkflowStep): string {
    const prompt = step.prompt ?? "";
    if (!prompt) return prompt;
    const vars = this.buildTemplateVars(step);
    const resolved = resolveTemplate(prompt, vars);
    // Ground every step in the brief. Prepend it as a labeled context block
    // unless the prompt already expanded {{brief}} itself (avoids duplication).
    if (this.brief && !resolved.includes(this.brief)) {
      return `## Brief\n\n${this.brief}\n\n---\n\n${resolved}`;
    }
    return resolved;
  }

  /**
   * Execute the full workflow, step by step, respecting gates.
   * Returns a map of output IDs (or step IDs) to their outputs.
   */
  async execute(): Promise<Map<string, unknown>> {
    this.emitEvent({
      type: "workflow_start",
      timestamp: new Date().toISOString(),
      workflow_id: this.config.id,
      steps: this.config.steps.map((s) => s.id),
    });

    for (const step of this.config.steps) {
      await this.runStep(step);
    }

    this.emitEvent({
      type: "workflow_end",
      timestamp: new Date().toISOString(),
      workflow_id: this.config.id,
      steps_completed: this.completedSteps,
      gates_passed: this.gatesPassed,
    });

    return this.stepOutputs;
  }

  /**
   * Get the outputs collected so far (useful for inspection mid-workflow).
   */
  getStepOutputs(): Map<string, unknown> {
    return new Map(this.stepOutputs);
  }

  /**
   * Get the list of completed step IDs in execution order.
   */
  getCompletedSteps(): string[] {
    return [...this.completedSteps];
  }

  // ── Private ────────────────────────────────────────────────────────

  /** Resolve a step output by output name or step ID. */
  private resolveOutput(inputId: string): unknown {
    // Try direct lookup (inputId is an output name)
    let value = this.stepOutputs.get(inputId);
    if (value === undefined) {
      // Fall back: inputId might be a step ID — resolve via reverse map
      const outputKey = this.stepIdToOutputKey.get(inputId);
      if (outputKey) {
        value = this.stepOutputs.get(outputKey);
      }
    }
    return value;
  }

  private async runStep(step: WorkflowStep): Promise<void> {
    const stepStart = Date.now();

    this.emitEvent({
      type: "step_start",
      timestamp: new Date().toISOString(),
      step_id: step.id,
      action: step.action,
      agents: step.agents ?? [],
    });

    // Gather inputs from previous steps (resolve by output name first, then step ID)
    const inputs: Record<string, unknown> = {};
    for (const inputId of (step.input ?? [])) {
      inputs[inputId] = this.resolveOutput(inputId);
    }

    // Artifact injection: load referenced artifacts into context
    if (this.artifactManager && step.input && step.input.length > 0) {
      for (const inputId of step.input) {
        try {
          const formatted = await this.artifactManager.formatForInjection(inputId);
          inputs[`__artifact_${inputId}`] = formatted;
        } catch {
          // Artifact may not exist (e.g., step output without artifact) — skip
        }
      }
    }

    // Execute the step
    const output = await this.executeStep(step, inputs);
    const outputKey = step.output ?? step.id;
    this.stepOutputs.set(outputKey, output);
    this.stepIdToOutputKey.set(step.id, outputKey);
    this.completedSteps.push(step.id);

    // Create artifact from step output if artifact manager is available
    if (this.artifactManager && step.output) {
      const content = typeof output === "string"
        ? output
        : JSON.stringify(output, null, 2);
      const manifest = await this.artifactManager.createArtifact(step.output, content, {
        produced_by: step.agents ?? ["orchestrator"],
        step_id: step.id,
        format: "markdown",
      });

      this.emitEvent({
        type: "artifact_write",
        timestamp: new Date().toISOString(),
        artifact_id: step.output,
        format: "markdown",
        content_path: manifest.content_path,
        revision: 1,
      });
    }

    const durationSeconds = (Date.now() - stepStart) / 1000;

    this.emitEvent({
      type: "step_end",
      timestamp: new Date().toISOString(),
      step_id: step.id,
      artifact_id: step.output ?? null,
      duration_seconds: durationSeconds,
    });

    // Check for gate after this step
    const gate = this.config.gates.find((g) => g.after === step.id);
    if (gate) {
      await this.executeGate(gate, step, inputs);
    }
  }

  private async executeStep(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    this.adapter.notify(
      `[${this.config.id}] Step: ${step.description ?? step.id}`,
      "info",
    );

    switch (step.action) {
      case "targeted-delegation":
        return this.executeTargetedDelegation(step, inputs);

      case "tension-pair":
        return this.executeTensionPair(step, inputs);

      case "orchestrator-synthesis":
        return this.executeOrchestratorSynthesis(step, inputs);

      case "execute-with-tools":
        return this.executeWithTools(step, inputs);

      // Execution-mode A2A: hand the step's resolved prompt to a remote
      // ADK/A2A agent (routed through CompositeRuntime → A2aConnector by its
      // remote_ref) and ingest the response as the step output. `adk-graph`
      // is the ADK-flavoured synonym (the remote runs a Workflow(edges) graph
      // server-side). No schema change — these are convention values on the
      // free-text `action` field, intercepted before the default passthrough.
      case "a2a-delegate":
      case "adk-graph":
        return this.executeRemoteStep(step, inputs);

      default:
        // Existing behavior for "gather", "process", etc.
        return { stepId: step.id, action: step.action, inputs };
    }
  }

  private async executeTargetedDelegation(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    const agents = step.agents ?? [];
    const prompt = this.resolveStepPrompt(step);

    // Load actual input artifact content via artifactManager
    const inputArtifacts: Record<string, string> = {};
    if (this.artifactManager && step.input) {
      for (const inputId of step.input) {
        try {
          const formatted = await this.artifactManager.formatForInjection(inputId);
          inputArtifacts[inputId] = formatted;
        } catch {
          // Artifact may not exist yet — use step output as fallback
          const stepOutput = this.resolveOutput(inputId);
          if (stepOutput !== undefined) {
            inputArtifacts[inputId] = typeof stepOutput === "string"
              ? stepOutput
              : JSON.stringify(stepOutput, null, 2);
          }
        }
      }
    }

    this.adapter.notify(
      `[${this.config.id}] Targeted delegation to [${agents.join(", ")}]: ${prompt}`,
      "info",
    );

    // Build the full prompt: resolved prompt + input artifact content
    const artifactContext = Object.entries(inputArtifacts)
      .map(([id, content]) => `--- Input: ${id} ---\n${content}`)
      .join("\n\n");
    const fullPrompt = artifactContext
      ? `${prompt}\n\n${artifactContext}`
      : prompt;

    // Use delegation delegate if available for real agent execution
    if (this.delegationDelegate) {
      const responses = await this.delegationDelegate.delegateToAgents(agents, fullPrompt);
      return responses.map((r) => r.text).join("\n\n");
    }

    // Fallback: no delegate available — return structured placeholder
    this.adapter.notify(
      `[${this.config.id}] Would dispatch parallel to agents: ${agents.join(", ")}`,
      "info",
    );

    return {
      stepId: step.id,
      action: step.action,
      agents,
      prompt,
      inputs,
      input_artifacts: inputArtifacts,
      delegation: "pending",
    };
  }

  /**
   * Execution-mode A2A step (`a2a-delegate` / `adk-graph`). Delegates the
   * step's resolved prompt (plus its input artifacts) to ONE remote agent and
   * ingests the response text as the step output. The target is `step.agents[0]`
   * — a remote-agent config (kind `aos/remote-agent/v1`) whose `remote_ref` the
   * CompositeRuntime routes to the A2aConnector. Unlike a deliberation member,
   * it bypasses the bias router via `delegationDelegate.delegateDirect`.
   *
   * This is a genuine remote call, so (unlike targeted-delegation) there is no
   * structured placeholder fallback — a missing delegate is a hard error.
   */
  private async executeRemoteStep(
    step: WorkflowStep,
    _inputs: Record<string, unknown>,
  ): Promise<unknown> {
    const agentId = (step.agents ?? [])[0];
    if (!agentId) {
      throw new Error(
        `${step.action} step "${step.id}" requires a remote agent in 'agents' (e.g. agents: [my-remote-agent])`,
      );
    }
    if (!this.delegationDelegate?.delegateDirect) {
      throw new Error(
        `${step.action} step "${step.id}" needs an execution-mode delegate (delegateDirect); ` +
          `none was provided to the WorkflowRunner`,
      );
    }

    const prompt = this.resolveStepPrompt(step);
    const fullPrompt = await this.buildPromptWithInputs(step, prompt);

    this.adapter.notify(
      `[${this.config.id}] ${step.action} → remote agent "${agentId}": ${prompt}`,
      "info",
    );

    const response = await this.delegationDelegate.delegateDirect(agentId, fullPrompt);
    return response.text;
  }

  /**
   * Append any input-artifact content to a resolved step prompt. Loads each
   * referenced artifact via the ArtifactManager, falling back to a prior
   * step output when the artifact file does not exist yet. Shared by the
   * delegation/execution step paths.
   */
  private async buildPromptWithInputs(step: WorkflowStep, prompt: string): Promise<string> {
    const inputArtifacts: Record<string, string> = {};
    if (this.artifactManager && step.input) {
      for (const inputId of step.input) {
        try {
          inputArtifacts[inputId] = await this.artifactManager.formatForInjection(inputId);
        } catch {
          const stepOutput = this.resolveOutput(inputId);
          if (stepOutput !== undefined) {
            inputArtifacts[inputId] = typeof stepOutput === "string"
              ? stepOutput
              : JSON.stringify(stepOutput, null, 2);
          }
        }
      }
    }
    const artifactContext = Object.entries(inputArtifacts)
      .map(([id, content]) => `--- Input: ${id} ---\n${content}`)
      .join("\n\n");
    return artifactContext ? `${prompt}\n\n${artifactContext}` : prompt;
  }

  private async executeTensionPair(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    const agents = step.agents ?? [];

    if (agents.length !== 2) {
      this.adapter.notify(
        `[${this.config.id}] tension-pair requires exactly 2 agents, got ${agents.length}`,
        "error",
      );
      throw new Error(
        `tension-pair step "${step.id}" requires exactly 2 agents, got ${agents.length}`,
      );
    }

    const prompt = this.resolveStepPrompt(step);

    // Load actual input artifact content via artifactManager
    const inputArtifacts: Record<string, string> = {};
    if (this.artifactManager && step.input) {
      for (const inputId of step.input) {
        try {
          const formatted = await this.artifactManager.formatForInjection(inputId);
          inputArtifacts[inputId] = formatted;
        } catch {
          const stepOutput = this.resolveOutput(inputId);
          if (stepOutput !== undefined) {
            inputArtifacts[inputId] = typeof stepOutput === "string"
              ? stepOutput
              : JSON.stringify(stepOutput, null, 2);
          }
        }
      }
    }

    this.adapter.notify(
      `[${this.config.id}] Tension pair [${agents[0]} vs ${agents[1]}]: ${prompt}`,
      "info",
    );

    // Build the full prompt: resolved prompt + input artifact content
    const artifactContext = Object.entries(inputArtifacts)
      .map(([id, content]) => `--- Input: ${id} ---\n${content}`)
      .join("\n\n");
    const fullPrompt = artifactContext
      ? `${prompt}\n\n${artifactContext}`
      : prompt;

    // Use delegation delegate if available for real agent execution
    if (this.delegationDelegate) {
      const responses = await this.delegationDelegate.delegateTensionPair(agents[0], agents[1], fullPrompt);
      return responses.map((r) => r.text).join("\n\n");
    }

    // Fallback: no delegate available — return structured placeholder
    this.adapter.notify(
      `[${this.config.id}] Would send to ${agents[0]}: prompt, then ${agents[1]}: prompt + response, then ${agents[0]}: rebuttal`,
      "info",
    );

    return {
      stepId: step.id,
      action: step.action,
      agents,
      prompt,
      inputs,
      input_artifacts: inputArtifacts,
      delegation: "pending",
      tension_flow: [
        { agent: agents[0], role: "initial", prompt },
        { agent: agents[1], role: "challenge", prompt: `[response from ${agents[0]}] + ${prompt}` },
        { agent: agents[0], role: "rebuttal", prompt: `[response from ${agents[1]}]` },
      ],
    };
  }

  private async executeOrchestratorSynthesis(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    const prompt = this.resolveStepPrompt(step);

    // Collect all input artifacts — load actual content when possible
    const collectedInputs: Record<string, unknown> = {};
    const inputArtifacts: Record<string, string> = {};

    for (const inputId of (step.input ?? [])) {
      collectedInputs[inputId] = this.resolveOutput(inputId);

      // Try to load artifact content for richer synthesis
      if (this.artifactManager) {
        try {
          const formatted = await this.artifactManager.formatForInjection(inputId);
          inputArtifacts[inputId] = formatted;
        } catch {
          // Artifact may not exist — use step output as fallback
          const stepOutput = this.resolveOutput(inputId);
          if (stepOutput !== undefined) {
            inputArtifacts[inputId] = typeof stepOutput === "string"
              ? stepOutput
              : JSON.stringify(stepOutput, null, 2);
          }
        }
      }
    }

    // Build synthesis content from available artifacts
    const synthesisContent = Object.entries(inputArtifacts).length > 0
      ? Object.entries(inputArtifacts)
          .map(([id, content]) => `--- Input: ${id} ---\n${content}`)
          .join("\n\n")
      : Object.entries(collectedInputs)
          .map(([id, content]) => `--- Input: ${id} ---\n${typeof content === "string" ? content : JSON.stringify(content, null, 2)}`)
          .join("\n\n");

    this.adapter.notify(
      `[${this.config.id}] Orchestrator synthesis: ${prompt} (inputs: ${Object.keys(collectedInputs).join(", ")})`,
      "info",
    );

    // Build the full prompt: resolved prompt + all input artifacts as context
    const fullPrompt = synthesisContent
      ? `${prompt}\n\n${synthesisContent}`
      : prompt;

    // Use delegation delegate if available for real orchestrator execution
    if (this.delegationDelegate) {
      const response = await this.delegationDelegate.delegateToOrchestrator(fullPrompt);
      return response.text;
    }

    // Fallback: no delegate available — return structured placeholder
    return {
      stepId: step.id,
      action: step.action,
      prompt,
      synthesis_inputs: collectedInputs,
      input_artifacts: inputArtifacts,
      synthesis_content: synthesisContent,
    };
  }

  private async executeWithTools(
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    const prompt = this.resolveStepPrompt(step);

    this.adapter.notify(
      `[${this.config.id}] Execute with tools: ${prompt}`,
      "info",
    );

    // Attempt code execution or skill invocation via the adapter.
    // These may not be supported by all adapters — catch UnsupportedError gracefully.
    let executionResult: unknown = null;

    try {
      // Resolve agent config: use real agent if specified, else generic stub
      const specifiedAgent = step.agents?.[0];
      let agentConfig: AgentConfig;

      if (specifiedAgent && this.agents?.has(specifiedAgent)) {
        agentConfig = this.agents.get(specifiedAgent)!;
      } else {
        agentConfig = {
          schema: "aos/agent/v1",
          id: `${step.id}-executor`,
          name: step.name ?? step.id,
          role: "executor",
          cognition: {
            objective_function: "execute",
            time_horizon: { primary: "immediate", secondary: "", peripheral: "" },
            core_bias: "none",
            risk_tolerance: "moderate",
            default_stance: "neutral",
          },
          persona: {
            temperament: [],
            thinking_patterns: [],
            heuristics: [],
            evidence_standard: { convinced_by: [], not_convinced_by: [] },
            red_lines: [],
          },
          tensions: [],
          report: { structure: "flat" },
          tools: null,
          skills: [],
          expertise: [],
          model: { tier: "standard", thinking: "off" },
        };
      }

      // Create a temporary handle for execution
      const handle = await this.adapter.spawnAgent(
        agentConfig,
        this.config.id,
      );

      try {
        if (step.code) {
          // Explicit code provided — execute with safe sandbox defaults
          const opts: ExecuteCodeOpts = {
            timeout_ms: 30000,
            sandbox: "strict",
          };
          executionResult = await this.adapter.executeCode(handle, step.code, opts);
        } else {
          // No explicit code — send the prompt to the agent via sendMessage
          // and let the agent handle execution through its tools.
          // Never pass raw prompts directly to executeCode.
          const response = await this.adapter.sendMessage(handle, prompt);
          executionResult = response.text;
        }
      } catch (err) {
        if (err instanceof UnsupportedError) {
          this.adapter.notify(
            `[${this.config.id}] execution not supported by adapter, skipping`,
            "info",
          );
        } else {
          throw err;
        }
      }

      await this.adapter.destroyAgent(handle);
    } catch (err) {
      if (err instanceof UnsupportedError) {
        this.adapter.notify(
          `[${this.config.id}] Execution adapter not available, skipping`,
          "info",
        );
      } else {
        throw err;
      }
    }

    return {
      stepId: step.id,
      action: step.action,
      prompt,
      executionResult,
      inputs,
    };
  }

  private async executeGate(
    gate: WorkflowGate,
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<void> {
    if (gate.type === "user-approval") {
      if (gate.on_rejection === "retry_with_feedback") {
        await this.executeRetryWithFeedbackGate(gate, step, inputs);
      } else {
        await this.executeUserApprovalGate(gate, step, inputs);
      }
    } else if (gate.type === "automated-review") {
      await this.executeAutomatedReviewGate(gate, step, inputs);
    }
  }

  private async executeUserApprovalGate(
    gate: WorkflowGate,
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<void> {
    const gateId = `gate-${gate.after}`;

    this.emitEvent({
      type: "gate_prompt",
      timestamp: new Date().toISOString(),
      gate_id: gateId,
      after_step: gate.after,
      prompt: gate.prompt,
    });

    if (this.autoApprove) {
      this.emitEvent({
        type: "gate_result",
        timestamp: new Date().toISOString(),
        gate_id: gateId,
        result: "approved",
        reason: "auto_approve",
      });
      this.gatesPassed.push(gateId);
      return;
    }

    const approved = await this.adapter.promptConfirm("Review Gate", gate.prompt);

    this.emitEvent({
      type: "gate_result",
      timestamp: new Date().toISOString(),
      gate_id: gateId,
      result: approved ? "approved" : "rejected",
    });

    if (!approved) {
      // Collect feedback and re-run the step
      const feedback = await this.adapter.promptInput("What should change?");
      this.stepOutputs.set(`${step.id}_feedback`, feedback);

      // Re-execute the step with updated inputs (feedback is now available)
      inputs[`${step.id}_feedback`] = feedback;
      const output = await this.executeStep(step, inputs);
      this.stepOutputs.set(step.output ?? step.id, output);
    } else {
      this.gatesPassed.push(gateId);
    }
  }

  private async executeRetryWithFeedbackGate(
    gate: WorkflowGate,
    step: WorkflowStep,
    inputs: Record<string, unknown>,
  ): Promise<void> {
    const maxIterations = gate.max_iterations ?? 3;
    const gateId = `gate-${gate.after}`;
    let currentPrompt = step.prompt ?? "";

    if (this.autoApprove) {
      if (this.artifactManager && step.output) {
        await this.artifactManager.updateReviewStatus(step.output, "approved", gateId);
      }
      this.emitEvent({
        type: "gate_prompt",
        timestamp: new Date().toISOString(),
        gate_id: gateId,
        after_step: gate.after,
        prompt: gate.prompt,
      });
      this.emitEvent({
        type: "gate_result",
        timestamp: new Date().toISOString(),
        gate_id: gateId,
        result: "approved",
        reason: "auto_approve",
        iteration: 1,
      });
      this.gatesPassed.push(gateId);
      return;
    }

    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      this.emitEvent({
        type: "gate_prompt",
        timestamp: new Date().toISOString(),
        gate_id: gateId,
        after_step: gate.after,
        prompt: gate.prompt,
      });

      const approved = await this.adapter.promptConfirm("Review Gate", gate.prompt);

      this.emitEvent({
        type: "gate_result",
        timestamp: new Date().toISOString(),
        gate_id: gateId,
        result: approved ? "approved" : "rejected",
        iteration: iteration + 1,
      });

      if (approved) {
        // Update artifact review status to "approved"
        if (this.artifactManager && step.output) {
          await this.artifactManager.updateReviewStatus(
            step.output,
            "approved",
            gateId,
          );
        }
        this.gatesPassed.push(gateId);
        return;
      }

      // If we've exhausted max iterations, proceed with current output
      if (iteration >= maxIterations) {
        this.adapter.notify(
          `[${this.config.id}] Max retry iterations (${maxIterations}) reached for gate after ${step.id}, proceeding`,
          "info",
        );
        return;
      }

      // Get feedback from user
      const feedback = await this.adapter.promptInput("What needs to change?");
      this.stepOutputs.set(`${step.id}_feedback`, feedback);

      // Augment the step's prompt with the feedback
      const revisionNumber = iteration + 1;
      currentPrompt = `${step.prompt ?? ""}\n---\n## User Feedback (Revision ${revisionNumber})\n${feedback}\n---`;

      // Create a modified step with the augmented prompt
      const augmentedStep: WorkflowStep = { ...step, prompt: currentPrompt };

      // If artifactManager exists, revise the artifact to increment revision
      if (this.artifactManager && step.output) {
        // Re-execute the step with augmented prompt
        inputs[`${step.id}_feedback`] = feedback;
        const output = await this.executeStep(augmentedStep, inputs);
        this.stepOutputs.set(step.output ?? step.id, output);

        const content = typeof output === "string"
          ? output
          : JSON.stringify(output, null, 2);
        const manifest = await this.artifactManager.reviseArtifact(step.output, content);

        this.emitEvent({
          type: "artifact_write",
          timestamp: new Date().toISOString(),
          artifact_id: step.output,
          format: manifest.format,
          content_path: manifest.content_path,
          revision: manifest.metadata.revision,
        });
      } else {
        // Re-execute the step with augmented prompt
        inputs[`${step.id}_feedback`] = feedback;
        const output = await this.executeStep(augmentedStep, inputs);
        this.stepOutputs.set(step.output ?? step.id, output);
      }
    }
  }

  private async executeAutomatedReviewGate(
    gate: WorkflowGate,
    step: WorkflowStep,
    _inputs: Record<string, unknown>,
  ): Promise<void> {
    const maxIterations = gate.max_iterations ?? 3;
    const gateId = `gate-${gate.after}`;

    for (let i = 0; i < maxIterations; i++) {
      this.adapter.notify(
        `[${this.config.id}] Automated review iteration ${i + 1}/${maxIterations}`,
        "info",
      );

      this.emitEvent({
        type: "gate_prompt",
        timestamp: new Date().toISOString(),
        gate_id: gateId,
        after_step: gate.after,
        prompt: gate.prompt,
        iteration: i + 1,
      });

      // Attempt to submit for automated review via adapter.submitForReview()
      if (this.artifactManager && step.output && this.sessionDir) {
        try {
          const loaded = await this.adapter.loadArtifact(step.output, this.sessionDir);
          // Create a temporary reviewer handle
          const reviewerHandle = await this.adapter.spawnAgent(
            {
              schema: "aos/agent/v1",
              id: `${step.id}-reviewer`,
              name: `Reviewer for ${step.id}`,
              role: "reviewer",
              cognition: {
                objective_function: "review",
                time_horizon: { primary: "immediate", secondary: "", peripheral: "" },
                core_bias: "none",
                risk_tolerance: "low",
                default_stance: "critical",
              },
              persona: {
                temperament: [],
                thinking_patterns: [],
                heuristics: [],
                evidence_standard: { convinced_by: [], not_convinced_by: [] },
                red_lines: [],
              },
              tensions: [],
              report: { structure: "flat" },
              tools: null,
              skills: [],
              expertise: [],
              model: { tier: "standard", thinking: "off" },
            },
            this.config.id,
          );

          try {
            const reviewResult = await this.adapter.submitForReview(loaded, reviewerHandle, gate.prompt);

            this.emitEvent({
              type: "gate_result",
              timestamp: new Date().toISOString(),
              gate_id: gateId,
              result: reviewResult.status,
              iteration: i + 1,
              reviewer: reviewResult.reviewer,
            });

            await this.adapter.destroyAgent(reviewerHandle);

            if (reviewResult.status === "approved") {
              if (this.artifactManager) {
                await this.artifactManager.updateReviewStatus(step.output, "approved", gateId);
              }
              this.gatesPassed.push(gateId);
              return;
            }

            // If rejected/needs-revision and we have iterations left, continue the loop
            // (the step would need re-execution in a full implementation)
            this.adapter.notify(
              `[${this.config.id}] Automated review rejected: ${reviewResult.feedback ?? "no feedback"}`,
              "warning",
            );
          } catch (err) {
            await this.adapter.destroyAgent(reviewerHandle);
            throw err;
          }
        } catch (err) {
          if (err instanceof UnsupportedError) {
            this.adapter.notify(
              `[${this.config.id}] submitForReview not supported by adapter, passing gate as no-op`,
              "warning",
            );
            this.emitEvent({
              type: "gate_result",
              timestamp: new Date().toISOString(),
              gate_id: gateId,
              result: "approved",
              reason: "adapter_unsupported",
            });
            this.gatesPassed.push(gateId);
            return;
          }
          throw err;
        }
      } else {
        // No artifact manager or output — cannot perform review, pass as no-op
        this.adapter.notify(
          `[${this.config.id}] No artifact available for automated review, passing gate as no-op`,
          "warning",
        );
        this.emitEvent({
          type: "gate_result",
          timestamp: new Date().toISOString(),
          gate_id: gateId,
          result: "approved",
          reason: "no_artifact",
        });
        this.gatesPassed.push(gateId);
        return;
      }
    }

    // Exhausted max iterations without approval
    this.adapter.notify(
      `[${this.config.id}] Max automated review iterations (${maxIterations}) reached for gate after ${step.id}, proceeding`,
      "warning",
    );
  }
}
