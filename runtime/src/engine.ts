/**
 * AOSEngine — composes all runtime modules into a session lifecycle.
 *
 * Responsibilities:
 * - Load profile, agents, optional domain overlay
 * - Validate briefs
 * - Delegate messages with routing, constraint checking, and transcript recording
 * - Enforce session end guards (minimums must be met or a maximum hit)
 */

import { join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  AOSAdapter,
  AgentConfig,
  AgentHandle,
  AgentResponse,
  ChildAgentConfig,
  ConstraintState,
  DelegationDelegate,
  SessionCheckpoint,
  SpawnResult,
  TranscriptEntry,
} from "./types";
import { SessionCheckpointManager } from "./session-checkpoint";
import { ChildAgentManager } from "./child-agent-manager";
import { loadProfile, loadAgent, loadDomain, loadWorkflow, resolveWorkflowFile, validateBrief } from "./config-loader";
import { DomainEnforcer } from "./domain-enforcer";
import { ConstraintEngine } from "./constraint-engine";
import { DelegationRouter } from "./delegation-router";
import type { DelegationTarget } from "./delegation-router";
import { applyDomain } from "./domain-merger";
import { WorkflowRunner } from "./workflow-runner";
import type { WorkflowConfig } from "./workflow-runner";
import { renderArtifactGallery, renderExecutionPackage } from "./output-renderer";
import type { ArtifactManifest } from "./types";
import type { MemoryProvider, MemoryConfig, RecallResult, RememberId } from "./memory-provider";
import { loadMemoryConfig } from "./memory-config";

export interface EngineOpts {
  agentsDir: string;
  domain?: string;
  domainDir?: string;
  workflowsDir?: string;
  projectDir?: string;
  memoryProvider?: MemoryProvider;
  onTranscriptEvent?: (entry: TranscriptEntry) => void | Promise<void>;
  /**
   * Non-interactive execution: auto-approve every `user-approval` workflow gate
   * instead of prompting. Set by `aos run --yes` so execution profiles (which
   * halt at review gates) can run in CI or an unattended capture.
   */
  autoApprove?: boolean;
}

export class AOSEngine {
  private adapter: AOSAdapter;
  private profile: ReturnType<typeof loadProfile>;
  private agents: Map<string, AgentConfig> = new Map();
  /** Root dir holding per-agent config dirs; used to lazily load execution-mode (e.g. remote A2A) agents not in the assembly. */
  private agentsDir: string;
  private handles: Map<string, AgentHandle> = new Map();
  private constraintEngine: ConstraintEngine;
  private delegationRouter: DelegationRouter;
  private transcript: TranscriptEntry[] = [];
  private startTime: number = 0;
  private roundNumber: number = 0;
  private sessionId: string;
  private speaksLastAgent: string | null = null;
  private domainId: string | null = null;
  private domainEnforcers: Map<string, DomainEnforcer> = new Map();
  private workflowMode: boolean = false;
  private workflowConfig: WorkflowConfig | null = null;
  private workflowsDir: string | null = null;
  private autoApprove: boolean = false;
  private onTranscriptEvent?: (entry: TranscriptEntry) => void | Promise<void>;
  private childAgentManager: ChildAgentManager;
  private checkpointManager: SessionCheckpointManager;
  private checkpoint: SessionCheckpoint | null = null;
  private memoryProvider: MemoryProvider | null = null;
  private memoryConfig: MemoryConfig | null = null;
  private recallCount: number = 0;
  private projectDir: string;

  private resolveOutputPathTemplate(template: string, briefPath: string): string {
    return template
      .replace("{{session_id}}", this.sessionId)
      .replace("{{date}}", new Date().toISOString().slice(0, 10))
      .replace("{{brief_slug}}", briefPath.split("/").pop()?.replace(/\.\w+$/, "") ?? "brief");
  }

  private resolveArtifactGallerySource(results: Map<string, unknown>): unknown {
    const preferredKeys = ["revised_artifact", "interactive_artifact", "artifact_gallery", "rendered_variants"];
    for (const key of preferredKeys) {
      if (results.has(key)) return results.get(key);
    }
    const values = [...results.values()];
    return values.length > 0 ? values[values.length - 1] : null;
  }

  constructor(adapter: AOSAdapter, profilePath: string, opts: EngineOpts) {
    this.adapter = adapter;
    this.sessionId = this.generateSessionId();
    this.onTranscriptEvent = opts.onTranscriptEvent;
    this.projectDir = opts.projectDir ?? process.cwd();
    this.agentsDir = opts.agentsDir;

    // Load profile
    this.profile = loadProfile(profilePath);

    // Load all agents referenced in profile
    const agentIds = [
      this.profile.assembly.orchestrator,
      ...this.profile.assembly.perspectives.map((p) => p.agent),
    ];

    let agentConfigs: AgentConfig[] = [];
    for (const agentId of agentIds) {
      const agentDir = join(opts.agentsDir, agentId);
      const config = loadAgent(agentDir);
      agentConfigs.push(config);
    }

    // Apply domain overlay if provided
    if (opts.domain && opts.domainDir) {
      const domainDir = join(opts.domainDir, opts.domain);
      const domainConfig = loadDomain(domainDir);
      agentConfigs = applyDomain(agentConfigs, domainConfig);
      this.domainId = opts.domain;
    }

    // Store agents by ID
    for (const config of agentConfigs) {
      this.agents.set(config.id, config);
    }

    // Initialize domain enforcers for agents that have domain rules
    for (const [agentId, agentConfig] of this.agents) {
      if (agentConfig.domain) {
        this.domainEnforcers.set(agentId, new DomainEnforcer(agentConfig.domain));
      }
    }

    // Initialize child agent manager
    this.childAgentManager = new ChildAgentManager(
      this.profile.delegation?.max_delegation_depth ?? 2,
    );

    // Initialize checkpoint manager
    this.checkpointManager = new SessionCheckpointManager();

    // Find speaks-last agent
    for (const p of this.profile.assembly.perspectives) {
      if (p.structural_advantage === "speaks-last") {
        this.speaksLastAgent = p.agent;
      }
    }

    // Initialize constraint engine
    const authMode = adapter.getAuthMode();
    this.constraintEngine = new ConstraintEngine(this.profile.constraints, authMode);

    // Initialize delegation router
    this.delegationRouter = new DelegationRouter(
      this.profile.assembly.perspectives,
      this.profile.delegation.tension_pairs,
      this.profile.delegation.bias_limit,
      this.profile.delegation.opening_rounds,
    );

    // Detect workflow mode
    if (this.profile.workflow) {
      this.workflowMode = true;
      this.workflowsDir = opts.workflowsDir ?? null;
      if (this.workflowsDir) {
        // Resolve via the shared resolver so the flat `<name>.workflow.yaml`
        // files (all execution profiles) and the directory convention
        // (`<id>/workflow.yaml`, paperclip-worker) both load — matching how
        // `aos run` and `aos validate` locate the same workflow.
        const workflowFile = resolveWorkflowFile(this.workflowsDir, this.profile.workflow);
        this.workflowConfig = loadWorkflow(workflowFile);
      }
    }

    this.autoApprove = opts.autoApprove ?? false;

    if (opts.memoryProvider) {
      this.memoryProvider = opts.memoryProvider;
    }
  }

  async start(inputPath: string, opts?: { domain?: string; deliberationDir?: string }): Promise<void> {
    const validation = validateBrief(inputPath, this.profile.input.required_sections);
    if (!validation.valid) {
      const missing = validation.missing.map((s) => s.heading).join(", ");
      throw new Error(`Invalid brief: missing sections: ${missing}`);
    }

    this.startTime = Date.now();

    this.pushTranscript({
      type: "session_start",
      timestamp: new Date(this.startTime).toISOString(),
      session_id: this.sessionId,
      profile: this.profile.id,
      domain: opts?.domain || this.domainId || null,
      participants: [...this.agents.keys()],
      constraints: this.profile.constraints,
      auth_mode: this.adapter.getAuthMode(),
      brief_path: inputPath,
    });

    // Initialize memory
    if (this.memoryProvider && !this.memoryConfig) {
      this.memoryConfig = loadMemoryConfig(this.projectDir);
      await this.memoryProvider.initialize(this.memoryConfig);

      const wakeCtx = await this.memoryProvider.wake(
        this.memoryConfig.mempalace?.projectWing ?? this.profile.id,
      );

      if (wakeCtx.essentials) {
        this.pushTranscript({
          type: wakeCtx.truncated ? "memory_wake_truncated" : "memory_wake",
          timestamp: new Date().toISOString(),
          tokenEstimate: wakeCtx.tokenEstimate,
          truncated: wakeCtx.truncated,
        });
      }

      this.recallCount = 0;
    }

    // Workflow mode: create artifacts directory and run workflow
    if (this.workflowMode && this.workflowConfig) {
      const deliberationDir = opts?.deliberationDir ?? join(process.cwd(), ".aos", this.sessionId);
      const artifactsDir = join(deliberationDir, "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      // Thread the loaded brief into the workflow so every step prompt is
      // grounded in the actual feature request. Without this, execution-mode
      // agents receive an unresolved/absent brief and correctly refuse to
      // fabricate — leaving the execution package empty (deliberation mode
      // injects the brief separately, in adapter-session).
      const briefContent = readFileSync(inputPath, "utf-8");

      const runner = new WorkflowRunner(this.workflowConfig, this.adapter, {
        sessionDir: deliberationDir,
        onTranscriptEvent: (e) => this.pushTranscript(e),
        delegationDelegate: this.createDelegationDelegate(),
        profileConfig: this.profile,
        agents: this.agents,    // pass agent configs for executeWithTools resolution
        brief: briefContent,
        autoApprove: this.autoApprove,
      });

      const results = await runner.execute();
      this.workflowResults = results;

      // Render execution package if profile output format requests it
      if (this.profile.output.format === "execution-package") {
        const elapsedMinutes = (Date.now() - this.startTime) / 60000;

        // Collect artifacts from the workflow runner's results
        const artifacts = new Map<string, { manifest: ArtifactManifest; content: string }>();
        for (const [stepId, output] of results) {
          const content = typeof output === "string" ? output : JSON.stringify(output, null, 2);
          artifacts.set(stepId, {
            manifest: {
              schema: "aos/artifact/v1",
              id: stepId,
              produced_by: [],
              step_id: stepId,
              format: "markdown",
              content_path: "",
              metadata: {
                produced_at: new Date().toISOString(),
                review_status: "pending",
                review_gate: null,
                word_count: content.split(/\s+/).filter(Boolean).length,
                revision: 1,
              },
            },
            content,
          });
        }

        const completedSteps = [...results.keys()];
        const gatesPassed = this.transcript
          .filter((e) => e.type === "gate_result" && e.result === "approved")
          .map((e) => e.gate_id as string);

        const rendered = renderExecutionPackage({
          profile: this.profile.id,
          workflow: this.workflowConfig!.id,
          sessionId: this.sessionId,
          domain: this.domainId,
          participants: [...this.agents.keys()],
          briefPath: inputPath,
          transcriptPath: join(deliberationDir, "transcript.jsonl"),
          durationMinutes: Math.round(elapsedMinutes * 100) / 100,
          stepsCompleted: completedSteps,
          gatesPassed,
          artifacts,
          sections: this.profile.output.sections,
        });

        const outputPath = this.resolveOutputPathTemplate(this.profile.output.path_template, inputPath);

        await this.adapter.writeFile(outputPath, rendered);
        this.adapter.notify(`Execution package written to ${outputPath}`, "info");
      } else if (this.profile.output.format === "artifact-gallery") {
        const gallerySource = this.resolveArtifactGallerySource(results);
        if (gallerySource == null) {
          throw new Error(`Workflow "${this.workflowConfig!.id}" did not produce an artifact gallery output`);
        }

        const outputDir = this.resolveOutputPathTemplate(this.profile.output.path_template, inputPath);
        const renderedGallery = renderArtifactGallery({
          profile: this.profile.id,
          sessionId: this.sessionId,
          briefPath: inputPath,
          briefContent: readFileSync(inputPath, "utf-8"),
          participants: [...this.agents.keys()],
          source: gallerySource as any,
        });

        for (const file of renderedGallery.files) {
          await this.adapter.writeFile(join(outputDir, file.path), file.content);
        }
        this.adapter.notify(`Artifact gallery written to ${join(outputDir, "index.html")}`, "info");
      }

      this.pushTranscript({
        type: "session_end",
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        roundsCompleted: this.roundNumber,
        mode: "workflow",
      });
    }
  }

  async recallMemory(
    query: string,
    opts: { agentId?: string; hall?: string; maxResults?: number } = {},
  ): Promise<RecallResult> {
    if (!this.memoryProvider || !this.memoryConfig) {
      throw new Error("Memory provider is not initialized.");
    }

    const maxRecall = this.memoryConfig.orchestrator.maxRecallPerSession;
    if (this.recallCount >= maxRecall) {
      this.pushTranscript({
        type: "memory_recall_denied",
        timestamp: new Date().toISOString(),
        query,
        reason: "max_recall_per_session",
        maxRecallPerSession: maxRecall,
      });
      throw new Error(`Memory recall limit reached (${maxRecall} per session).`);
    }

    const projectId = this.memoryConfig.mempalace?.projectWing ?? this.profile.id;
    const result = await this.memoryProvider.recall(query, {
      projectId,
      agentId: opts.agentId,
      hall: opts.hall,
      maxResults: opts.maxResults,
    });
    this.recallCount += 1;

    this.pushTranscript({
      type: "memory_recall",
      timestamp: new Date().toISOString(),
      query,
      projectId,
      agentId: opts.agentId ?? null,
      hall: opts.hall ?? null,
      resultCount: result.entries.length,
      tokenEstimate: result.tokenEstimate,
    });

    return result;
  }

  async rememberMemory(
    content: string,
    opts: { agentId: string; hall?: string; source?: string } = { agentId: "arbiter" },
  ): Promise<RememberId> {
    if (!this.memoryProvider || !this.memoryConfig) {
      throw new Error("Memory provider is not initialized.");
    }

    const projectId = this.memoryConfig.mempalace?.projectWing ?? this.profile.id;
    try {
      const id = await this.memoryProvider.remember(content, {
        projectId,
        agentId: opts.agentId,
        hall: opts.hall,
        source: opts.source,
        sessionId: this.sessionId,
      });
      this.pushTranscript({
        type: "memory_committed",
        timestamp: new Date().toISOString(),
        memoryId: id,
        projectId,
        agentId: opts.agentId,
        hall: opts.hall ?? null,
        source: opts.source ?? null,
      });
      return id;
    } catch (err) {
      this.pushTranscript({
        type: "memory_commit_failed",
        timestamp: new Date().toISOString(),
        projectId,
        agentId: opts.agentId,
        hall: opts.hall ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Results from a completed workflow run, if in workflow mode. */
  private workflowResults: Map<string, unknown> | null = null;

  /** Get the workflow results (only populated after workflow mode completes). */
  getWorkflowResults(): Map<string, unknown> | null {
    return this.workflowResults;
  }

  /** Check if the engine is running in workflow mode. */
  isWorkflowMode(): boolean {
    return this.workflowMode;
  }

  async delegateMessage(to: string | string[] | "all", message: string): Promise<AgentResponse[]> {
    this.roundNumber += 1;

    // Resource exhaustion protection (M5 from security audit)
    const maxParallelAgents = 15;
    const allPerspectives = this.profile.assembly.perspectives;
    if (allPerspectives.length > maxParallelAgents) {
      throw new Error(`Too many parallel agents (${allPerspectives.length}). Maximum is ${maxParallelAgents}.`);
    }

    // Parse target
    let target: DelegationTarget;
    if (to === "all") {
      target = { type: "broadcast" };
    } else if (Array.isArray(to)) {
      target = { type: "targeted", agents: to };
    } else {
      target = { type: "targeted", agents: [to] };
    }

    // Resolve routing
    const routing = this.delegationRouter.resolve(target, this.roundNumber);

    if (routing.blocked) {
      throw new Error(
        `Delegation blocked by bias limit. Neglected agents: ${routing.neglected.join(", ")}`,
      );
    }

    // Pre-round budget estimation (spec Section 6.7)
    const agentCount = routing.parallel.length + routing.sequential.length;
    const modelCost = this.adapter.getModelCost("standard");
    const estimatedTokens = this.profile.budget_estimation?.fixed_estimate_tokens ?? 2000;
    const safetyMargin = this.profile.budget_estimation?.safety_margin ?? 0.15;
    const estimatedCost = this.constraintEngine.estimateRoundCost(agentCount, estimatedTokens, modelCost);
    const headroom = this.constraintEngine.checkBudgetHeadroom(estimatedCost, safetyMargin);

    if (headroom < 0 && isFinite(headroom)) {
      // Drop optional agents first
      const requiredOnly = routing.parallel.filter((id) => {
        const member = this.profile.assembly.perspectives.find((p) => p.agent === id);
        return member?.required ?? false;
      });
      if (requiredOnly.length < routing.parallel.length) {
        routing.parallel = requiredOnly;
        this.pushTranscript({
          type: "budget_estimate",
          timestamp: new Date().toISOString(),
          round: this.roundNumber,
          estimatedCost,
          headroom,
          action: "drop_optional",
          droppedCount: agentCount - requiredOnly.length - routing.sequential.length,
        });
      }
    }

    // Ensure agent handles exist
    const allAgents = [...routing.parallel, ...routing.sequential];
    for (const agentId of allAgents) {
      if (!this.handles.has(agentId)) {
        const config = this.agents.get(agentId);
        if (!config) {
          throw new Error(`Unknown agent: ${agentId}`);
        }
        const handle = await this.adapter.spawnAgent(config, this.sessionId);
        this.handles.set(agentId, handle);

        this.pushTranscript({
          type: "agent_spawn",
          timestamp: new Date().toISOString(),
          agentId,
        });
      }
    }

    // Record delegation in transcript
    this.pushTranscript({
      type: "delegation",
      timestamp: new Date().toISOString(),
      round: this.roundNumber,
      target: to,
      message,
      parallel: routing.parallel,
      sequential: routing.sequential,
    });

    const responses: AgentResponse[] = [];

    // Read error_handling config from profile (spec Section 6.5)
    const errorHandling = this.profile.error_handling;
    const failureAction = errorHandling?.on_agent_failure ?? "skip";
    const timeoutMs = this.getAgentTimeoutMs();

    // Dispatch parallel agents
    if (routing.parallel.length > 0) {
      const parallelHandles = routing.parallel.map((id) => this.handles.get(id)!);
      const parallelResponses = await this.adapter.dispatchParallel(parallelHandles, message, { timeoutMs });

      for (let i = 0; i < routing.parallel.length; i++) {
        const resp = parallelResponses[i];

        // Handle agent failure per error_handling config
        if (resp.status === "failed") {
          this.pushTranscript({
            type: "error",
            timestamp: new Date().toISOString(),
            agentId: routing.parallel[i],
            round: this.roundNumber,
            error: resp.error || "Agent failed",
          });

          if (failureAction === "abort_round") {
            throw new Error(`Agent ${routing.parallel[i]} failed: ${resp.error}. Aborting round.`);
          }
          if (failureAction === "abort_session") {
            throw new Error(`Agent ${routing.parallel[i]} failed: ${resp.error}. Aborting session.`);
          }
          // "skip": include failed response with status, continue
        }

        responses.push(resp);
        this.pushTranscript({
          type: "response",
          timestamp: new Date().toISOString(),
          agentId: routing.parallel[i],
          round: this.roundNumber,
          text: resp.text,
          cost: resp.cost,
          status: resp.status,
        });
      }
    }

    // Dispatch sequential agents (speaks-last)
    for (const agentId of routing.sequential) {
      const handle = this.handles.get(agentId)!;
      const response = await this.adapter.sendMessage(handle, message, { timeoutMs });

      // Handle agent failure per error_handling config
      if (response.status === "failed") {
        this.pushTranscript({
          type: "error",
          timestamp: new Date().toISOString(),
          agentId,
          round: this.roundNumber,
          error: response.error || "Agent failed",
        });

        if (failureAction === "abort_round") {
          throw new Error(`Agent ${agentId} failed: ${response.error}. Aborting round.`);
        }
        if (failureAction === "abort_session") {
          throw new Error(`Agent ${agentId} failed: ${response.error}. Aborting session.`);
        }
        // "skip": include failed response with status, continue
      }

      responses.push(response);
      this.pushTranscript({
        type: "response",
        timestamp: new Date().toISOString(),
        agentId,
        round: this.roundNumber,
        text: response.text,
        cost: response.cost,
        status: response.status,
      });
    }

    // Calculate round cost and elapsed time
    const roundCost = responses.reduce((sum, r) => sum + r.cost, 0);
    const elapsedMinutes = this.startTime > 0
      ? (Date.now() - this.startTime) / 60000
      : 0;

    this.constraintEngine.recordRound(roundCost, elapsedMinutes);

    // Update bias in constraint engine
    const biasState = this.delegationRouter.getBiasState();
    this.constraintEngine.updateBias(
      biasState.ratio,
      biasState.most_addressed,
      biasState.least_addressed,
      biasState.blocked,
    );

    // Emit constraint_check after every round (spec Section 6.10)
    const constraintState = this.constraintEngine.getState();
    this.pushTranscript({
      type: "constraint_check",
      timestamp: new Date().toISOString(),
      round: this.roundNumber,
      state: constraintState,
    });

    // Emit constraint_warning when approaching maximums (80%+)
    if (constraintState.approaching_any_maximum) {
      this.pushTranscript({
        type: "constraint_warning",
        timestamp: new Date().toISOString(),
        round: this.roundNumber,
        approaching_max_time: constraintState.approaching_max_time,
        approaching_max_budget: constraintState.approaching_max_budget,
        approaching_max_rounds: constraintState.approaching_max_rounds,
      });
    }

    return responses;
  }

  async end(closingMessage: string): Promise<AgentResponse[]> {
    const state = this.constraintEngine.getState();
    if (!state.can_end) {
      throw new Error(
        "Cannot end session: minimums not met and no maximum hit",
      );
    }

    // Emit end_session before the final broadcast (spec Section 6.10)
    this.pushTranscript({
      type: "end_session",
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      closingMessage,
    });

    // Route as broadcast (speaks-last gets final turn)
    const responses = await this.delegateMessage("all", closingMessage);

    // Tag final statements (replace the generic "response" entries just added)
    // The delegateMessage call above added "response" entries; re-tag the last N as final_statement
    const finalCount = responses.length;
    const transcriptLen = this.transcript.length;
    for (let i = transcriptLen - 1, tagged = 0; i >= 0 && tagged < finalCount; i--) {
      if (this.transcript[i].type === "response") {
        this.transcript[i].type = "final_statement";
        tagged++;
      }
    }

    this.pushTranscript({
      type: "session_end",
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      roundsCompleted: this.roundNumber,
    });

    return responses;
  }

  private createDelegationDelegate(): DelegationDelegate {
    return {
      delegateToAgents: async (agentIds: string[], message: string) => {
        return this.delegateMessage(agentIds, message);
      },
      delegateTensionPair: async (agent1: string, agent2: string, message: string) => {
        return this.delegateMessage([agent1, agent2], message);
        // Note: true tension pair (sequential challenge) would be:
        // const r1 = await this.delegateMessage([agent1], message);
        // const r2 = await this.delegateMessage([agent2], `${message}\n\n${r1[0].text}\n\nChallenge this.`);
        // return [...r1, ...r2];
      },
      delegateToOrchestrator: async (message: string) => {
        // The orchestrator is not in the perspectives list, so we send
        // directly via the adapter rather than going through delegateMessage
        // which routes through the DelegationRouter.
        const orchestratorId = this.profile.assembly.orchestrator;
        if (!this.handles.has(orchestratorId)) {
          const config = this.agents.get(orchestratorId);
          if (!config) {
            throw new Error(`Unknown orchestrator agent: ${orchestratorId}`);
          }
          const handle = await this.adapter.spawnAgent(config, this.sessionId);
          this.handles.set(orchestratorId, handle);
          this.pushTranscript({
            type: "agent_spawn",
            timestamp: new Date().toISOString(),
            agentId: orchestratorId,
          });
        }
        const handle = this.handles.get(orchestratorId)!;
        const response = await this.adapter.sendMessage(handle, message, {
          timeoutMs: this.getAgentTimeoutMs(),
        });
        this.pushTranscript({
          type: "response",
          timestamp: new Date().toISOString(),
          agentId: orchestratorId,
          round: this.roundNumber,
          text: response.text,
          cost: response.cost,
          status: response.status,
        });
        return response;
      },
      delegateDirect: async (agentId: string, message: string) => {
        // Execution-mode: send directly to one agent, bypassing the
        // DelegationRouter (no bias accounting, no "must be a perspective"
        // gate). The target may be a remote A2A agent — since the engine's
        // adapter is a CompositeRuntime, a config with a remote_ref is
        // dispatched through the A2aConnector transparently. Mirrors
        // delegateToOrchestrator's direct-dispatch shape.
        if (!this.handles.has(agentId)) {
          // Load on demand: an execution-mode remote agent need not be an
          // assembly perspective, so it may not be in the preloaded map.
          let config = this.agents.get(agentId);
          if (!config) {
            try {
              config = loadAgent(join(this.agentsDir, agentId));
              this.agents.set(agentId, config);
            } catch {
              throw new Error(`Unknown agent: ${agentId}`);
            }
          }
          const handle = await this.adapter.spawnAgent(config, this.sessionId);
          this.handles.set(agentId, handle);
          this.pushTranscript({
            type: "agent_spawn",
            timestamp: new Date().toISOString(),
            agentId,
          });
        }
        const handle = this.handles.get(agentId)!;
        const response = await this.adapter.sendMessage(handle, message, {
          timeoutMs: this.getAgentTimeoutMs(),
        });
        this.pushTranscript({
          type: "response",
          timestamp: new Date().toISOString(),
          agentId,
          round: this.roundNumber,
          text: response.text,
          cost: response.cost,
          status: response.status,
        });
        return response;
      },
    };
  }

  async spawnChildAgent(parentAgentId: string, config: ChildAgentConfig): Promise<SpawnResult> {
    // Check parent agent has delegation.can_spawn
    const parentConfig = this.agents.get(parentAgentId);
    if (!parentConfig?.delegation?.can_spawn) {
      return { success: false, error: "child_not_found", childAgentId: parentAgentId };
    }

    const parentHandle = this.handles.get(parentAgentId);
    const parentDepth = parentHandle?.depth ?? 0;

    // Check depth limit
    const depthCheck = this.childAgentManager.canSpawnAtDepth(parentDepth);
    if (!depthCheck.allowed) {
      return {
        success: false,
        error: "depth_limit_exceeded",
        currentDepth: parentDepth,
        maxDepth: this.childAgentManager.getMaxDepth(),
        suggestion: "execute_directly",
      };
    }

    // Check max_children
    const maxChildren = parentConfig.delegation.max_children;
    const childrenCheck = this.childAgentManager.canSpawn(parentAgentId, maxChildren);
    if (!childrenCheck.allowed) {
      return {
        success: false,
        error: "max_children_exceeded",
        active: this.childAgentManager.getChildren(parentAgentId).length,
        max: maxChildren,
      };
    }

    // Narrow domain rules if parent has domain and child config specifies domain
    let childDomainRules = config.domainRules;
    if (parentConfig.domain && childDomainRules) {
      childDomainRules = this.childAgentManager.narrowDomain(parentConfig.domain, childDomainRules);
    }

    // Call adapter.spawnSubAgent
    const childHandle = await this.adapter.spawnSubAgent(parentAgentId, config, this.sessionId);

    // Set handle fields
    childHandle.parentAgentId = parentAgentId;
    childHandle.depth = parentDepth + 1;

    // Register child
    this.childAgentManager.registerChild(parentAgentId, childHandle);
    this.handles.set(childHandle.agentId, childHandle);

    // Build domain enforcer for child if domain rules provided
    if (childDomainRules) {
      const { DomainEnforcer } = await import("./domain-enforcer");
      this.domainEnforcers.set(childHandle.agentId, new DomainEnforcer(childDomainRules));
    }

    // Emit agent_spawned transcript event
    this.pushTranscript({
      type: "agent_spawned",
      timestamp: new Date().toISOString(),
      parentAgentId,
      childAgentId: childHandle.agentId,
      depth: childHandle.depth,
      config: { name: config.name, role: config.role },
    });

    return { success: true, childAgentId: childHandle.agentId };
  }

  async destroyChildAgent(parentAgentId: string, childAgentId: string): Promise<void> {
    // Call adapter.destroySubAgent
    await this.adapter.destroySubAgent(parentAgentId, childAgentId);

    // Remove from childAgentManager
    this.childAgentManager.removeChild(parentAgentId, childAgentId);

    // Delete handle and domain enforcer
    this.handles.delete(childAgentId);
    this.domainEnforcers.delete(childAgentId);

    // Emit agent_destroyed event
    this.pushTranscript({
      type: "agent_destroyed",
      timestamp: new Date().toISOString(),
      parentAgentId,
      childAgentId,
    });
  }

  getChildAgents(parentAgentId: string): AgentHandle[] {
    return this.childAgentManager.getChildren(parentAgentId);
  }

  async pauseSession(reason?: string): Promise<SessionCheckpoint> {
    const state = this.constraintEngine.getState();
    const activeHandles = Array.from(this.handles.values());
    this.checkpoint = this.checkpointManager.createCheckpoint(
      this.sessionId, state, activeHandles, this.transcript, this.roundNumber, 50,
    );
    this.pushTranscript({
      type: "session_paused",
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      reason: reason ?? "user_requested",
      checkpoint: this.checkpoint,
    });
    return this.checkpoint;
  }

  getCheckpoint(): SessionCheckpoint | null {
    return this.checkpoint;
  }

  private generateSessionId(): string {
    return randomUUID().slice(0, 12);
  }

  getConstraintState(): ConstraintState {
    const state = this.constraintEngine.getState();

    // Update bias from delegation router
    const biasState = this.delegationRouter.getBiasState();
    state.bias_ratio = biasState.ratio;
    state.most_addressed = biasState.most_addressed;
    state.least_addressed = biasState.least_addressed;
    state.bias_blocked = biasState.blocked;

    return state;
  }

  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  getDomainEnforcer(agentId: string): DomainEnforcer | null {
    return this.domainEnforcers.get(agentId) ?? null;
  }

  private getAgentTimeoutMs(): number | undefined {
    const seconds = this.profile.error_handling?.agent_timeout_seconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
      return undefined;
    }
    return Math.round(seconds * 1000);
  }

  /** Push an external transcript entry (e.g., steer events from the adapter). */
  pushTranscript(entry: TranscriptEntry): void {
    this.transcript.push(entry);
    if (this.onTranscriptEvent) {
      try {
        const result = this.onTranscriptEvent(entry);
        if (result instanceof Promise) {
          result.catch(() => {});
        }
      } catch {
        // Silent failure — platform observability must never block deliberation
      }
    }
  }
}
