// ── adapter-session.ts ────────────────────────────────────────────
// Orchestration entrypoint used by the CLI to run a deliberation
// session against one of the non-Pi adapters (Claude Code, Gemini, Codex).
//
// Responsibilities:
//   1. Dynamically load the chosen AgentRuntime class.
//   2. Compose the 4 adapter layers into an AOSAdapter.
//   3. Build the AOSEngine and kick off with the brief.
//   4. Start a Unix-socket bridge that forwards MCP `delegate`/`end`
//      tool calls from the arbiter process into the engine.
//   5. Resolve the arbiter prompt template and spawn the arbiter,
//      threading MCP CLI flags through MessageOpts.extraArgs.
//   6. Run a readline loop for `/aos-*` interactive commands.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import readline from "node:readline";
import {
  BaseEventBus,
  TerminalUI,
  BaseWorkflow,
  composeAdapter,
  CompositeRuntime,
  LOCAL_CONNECTOR_KIND,
  discoverAgents,
  createFlatAgentsDir,
  type ToolPolicy,
} from "@aos-harness/adapter-shared";
import { A2A_CONNECTOR_KIND } from "@aos-harness/runtime/a2a-connector";
import { AOSEngine } from "@aos-harness/runtime";
import type { TranscriptEntry } from "@aos-harness/runtime/types";
import { loadAgent } from "@aos-harness/runtime/config-loader";
import { resolveTemplate } from "@aos-harness/runtime/template-resolver";
import {
  createRuntimeMemoryProvider,
  type RuntimeMemoryProvider,
} from "@aos-harness/runtime/memory-provider-factory";
import { startBridgeServer, bridgeSocketPath } from "./bridge-server";
import { renderTextGauge, renderRoundOneLiner } from "./gauges";
import { getAdapterDir } from "./utils";
import { createSessionMcpManager } from "./mcp-session";
import { createSessionA2aConnector } from "./a2a-session";

export interface AdapterSessionConfig {
  platform: string; // "claude-code" | "gemini" | "codex"
  profileDir: string;
  briefPath: string;
  domainName: string | null;
  root: string;
  sessionId: string;
  deliberationDir: string;
  verbose: boolean;
  workflowConfig: any | null;
  workflowsDir: string;
  modelOverrides?: Partial<Record<string, string>>;
  useVendorDefaultModel?: boolean;
  /**
   * Tool policy resolved by the CLI from the profile's `tools:` block narrowed
   * (optionally) by the `--allow-code-execution` flag. Passed straight into
   * BaseWorkflow to gate tool access during the session (spec D3).
   */
  toolPolicy?: ToolPolicy;
  /**
   * Path where BaseWorkflow should append tool-decision audit events
   * (one JSON object per line). Defaults to `<deliberationDir>/transcript.jsonl`
   * when omitted.
   */
  transcriptPath?: string;
  /**
   * Optional live observability endpoint. When present, transcript events are
   * also batched to `${platformUrl}/api/sessions/:id/events`.
   */
  platformUrl?: string;
  agentTimeoutMs?: number;
  /** Auto-approve execution-workflow review gates (aos run --yes). */
  autoApprove?: boolean;
}

function createStreamingPrinter() {
  let printedLength = 0;
  let printedAny = false;

  return {
    push(partial: string) {
      if (partial.length <= printedLength) return;
      const delta = partial.slice(printedLength);
      printedLength = partial.length;
      if (!delta) return;
      printedAny = true;
      process.stdout.write(delta);
    },
    flushFinal(text: string): boolean {
      if (!printedAny) return false;
      if (text.length > printedLength) {
        process.stdout.write(text.slice(printedLength));
        printedLength = text.length;
      }
      if (!text.endsWith("\n")) {
        process.stdout.write("\n");
      }
      return true;
    },
    hasOutput() {
      return printedAny;
    },
  };
}

const ADAPTER_MAP: Record<string, { package: string; className: string }> = {
  "claude-code": {
    package: "@aos-harness/claude-code-adapter",
    className: "ClaudeCodeAgentRuntime",
  },
  gemini: {
    package: "@aos-harness/gemini-adapter",
    className: "GeminiAgentRuntime",
  },
  codex: {
    package: "@aos-harness/codex-adapter",
    className: "CodexAgentRuntime",
  },
};

// CLI version read once at module load, used in the missing-adapter
// install hint and the version-mismatch warning.
function readCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "package.json"), "utf-8");
    return (JSON.parse(raw) as { version: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
const CLI_VERSION = readCliVersion();

// Classify an error from a dynamic import() as "package not installed".
// Bun 1.3.11 throws ResolveMessage with code=ERR_MODULE_NOT_FOUND. Older
// Bun/Node and edge cases are caught by constructor-name and message-regex
// fallbacks. Anything that doesn't match these patterns is a real error
// (syntax error, missing transitive dep, etc.) and must surface with its
// original stack — never swallowed as "not installed".
function isModuleNotFound(err: any): boolean {
  if (err?.code === "ERR_MODULE_NOT_FOUND") return true;
  if (err?.code === "MODULE_NOT_FOUND") return true;
  if (err?.constructor?.name === "ResolveMessage") return true;
  const msg = typeof err?.message === "string" ? err.message : "";
  return /Cannot find (module|package)/i.test(msg);
}

function printMissingAdapterError(pkg: string): void {
  const useColor = !!process.stderr.isTTY;
  const red = useColor ? "\x1b[31m" : "";
  const bold = useColor ? "\x1b[1m" : "";
  const reset = useColor ? "\x1b[0m" : "";
  console.error(
    `\n${red}${bold}✗ Adapter not installed: ${pkg}${reset}\n\n` +
      `Install it:\n` +
      `  npm i -g ${pkg}    # if aos-harness is installed globally\n` +
      `  npm i    ${pkg}    # if aos-harness is a project dependency\n\n` +
      `(or use bun / pnpm / yarn equivalents)\n\n` +
      `CLI version: aos-harness@${CLI_VERSION}. Pin the adapter to the same version.\n`,
  );
}

// Compare CLI and adapter versions. Under pre-1.0 lockstep, any minor or
// major drift is a warning — patch drift is silent (expected during
// quick-turnaround publishes).
function versionMismatchSeverity(cliVer: string, adapterVer: string): "none" | "warn" {
  const [cliMaj, cliMin] = cliVer.split(".").map(Number);
  const [adaMaj, adaMin] = adapterVer.split(".").map(Number);
  if (Number.isNaN(cliMaj) || Number.isNaN(adaMaj)) return "none";
  if (cliMaj !== adaMaj) return "warn";
  if (cliMin !== adaMin) return "warn";
  return "none";
}

const mismatchWarnedPackages = new Set<string>();

function maybeWarnVersionMismatch(pkg: string, adapterVer: string): void {
  if (mismatchWarnedPackages.has(pkg)) return;
  if (versionMismatchSeverity(CLI_VERSION, adapterVer) !== "warn") return;
  mismatchWarnedPackages.add(pkg);
  const useColor = !!process.stderr.isTTY;
  const y = useColor ? "\x1b[33m" : "";
  const r = useColor ? "\x1b[0m" : "";
  console.error(
    `\n${y}⚠ Version mismatch: aos-harness@${CLI_VERSION} and ${pkg}@${adapterVer}${r}\n` +
      `  Adapters are published lockstep with the CLI. Install matching versions:\n` +
      `  npm i -g ${pkg}@${CLI_VERSION}\n`,
  );
}

async function loadAdapterRuntime(platform: string): Promise<any> {
  const entry = ADAPTER_MAP[platform];
  if (!entry) throw new Error(`Unknown adapter: ${platform}`);

  const adapterDir = getAdapterDir(platform);
  if (!adapterDir) {
    printMissingAdapterError(entry.package);
    process.exit(2);
  }

  let mod: any;
  try {
    mod = await import(pathToFileURL(join(adapterDir, "src", "index.ts")).href);
  } catch (err) {
    if (isModuleNotFound(err)) {
      printMissingAdapterError(entry.package);
      process.exit(2);
    }
    throw err;
  }

  let version = "unknown";
  try {
    const raw = readFileSync(join(adapterDir, "package.json"), "utf-8");
    version = (JSON.parse(raw) as { version?: string }).version ?? "unknown";
  } catch {
    version = "unknown";
  }
  console.error(`[adapter] loaded ${entry.package}@${version}`);
  maybeWarnVersionMismatch(entry.package, version);
  return mod[entry.className];
}

function toolNamesForPlatform(platform: string): {
  delegate: string;
  end: string;
  recall: string;
  remember: string;
} {
  if (platform === "claude-code") {
    return {
      delegate: "mcp__aos__delegate",
      end: "mcp__aos__end",
      recall: "mcp__aos__aos_recall",
      remember: "mcp__aos__aos_remember",
    };
  }
  return { delegate: "delegate", end: "end", recall: "aos_recall", remember: "aos_remember" };
}

function createTranscriptSink(opts: {
  transcriptPath: string;
  platformUrl?: string;
  sessionId: string;
}) {
  const { transcriptPath, platformUrl, sessionId } = opts;
  const buffer: TranscriptEntry[] = [];
  const BATCH_SIZE = 20;
  const FLUSH_INTERVAL_MS = 500;
  const TIMEOUT_MS = 2000;

  mkdirSync(dirname(transcriptPath), { recursive: true });

  let flushing: Promise<void> | null = null;
  let sequence = 0;

  const platformHeaders = (): HeadersInit => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = process.env.AOS_PLATFORM_TOKEN ?? process.env.AOS_INGEST_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const stampEntry = (entry: TranscriptEntry): TranscriptEntry => {
    const existingSequence = typeof entry.sequence === "number" ? entry.sequence : null;
    const nextSequence = existingSequence ?? ++sequence;
    sequence = Math.max(sequence, nextSequence);
    return {
      ...entry,
      sequence: nextSequence,
      event_id: typeof entry.event_id === "string" && entry.event_id
        ? entry.event_id
        : `${sessionId}:${nextSequence}`,
    };
  };

  const flush = async (requeueOnFailure = true): Promise<void> => {
    if (!platformUrl || buffer.length === 0) return;
    const batch = buffer.splice(0, BATCH_SIZE);
    try {
      const response = await fetch(`${platformUrl}/api/sessions/${sessionId}/events`, {
        method: "POST",
        headers: platformHeaders(),
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Don't follow redirects: a 3xx would re-send the body + auth header to
        // the redirect target (possibly a different host) — credential leak/SSRF.
        redirect: "manual",
      });
      if (!response.ok) {
        throw new Error(`platform ingest failed: HTTP ${response.status}`);
      }
    } catch {
      if (requeueOnFailure) buffer.unshift(...batch);
      // Best-effort observability only.
    }
  };

  const scheduleFlush = (): Promise<void> => {
    if (!platformUrl) return Promise.resolve();
    if (!flushing) {
      flushing = flush().finally(() => {
        flushing = null;
      });
    }
    return flushing;
  };

  const interval = platformUrl
    ? setInterval(() => {
        void scheduleFlush();
      }, FLUSH_INTERVAL_MS)
    : null;

  return {
    enqueue(entry: TranscriptEntry) {
      const stamped = stampEntry(entry);
      try {
        appendFileSync(transcriptPath, JSON.stringify(stamped) + "\n");
      } catch {
        // Transcript persistence should not fail the session.
      }
      if (platformUrl) {
        buffer.push(stamped);
        if (buffer.length >= BATCH_SIZE) {
          void scheduleFlush();
        }
      }
    },
    async shutdown() {
      if (interval) clearInterval(interval);
      await scheduleFlush();
      while (buffer.length > 0) {
        await flush(false);
      }
    },
  };
}

export async function runAdapterSession(config: AdapterSessionConfig): Promise<void> {
  const log = (msg: string) => {
    if (config.verbose) console.error(`[session] ${msg}`);
  };

  log("loading adapter runtime");
  const RuntimeClass = await loadAdapterRuntime(config.platform);

  // ── Layer composition ──────────────────────────────────────
  const eventBus = new BaseEventBus();
  const agentRuntime = new RuntimeClass(eventBus, config.modelOverrides, {
    useVendorDefaultModel: config.useVendorDefaultModel,
  });
  const ui = new TerminalUI();
  // ── Transcript sink (created early so MCP lifecycle events persist) ──
  const transcriptPath =
    config.transcriptPath ?? join(config.deliberationDir, "transcript.jsonl");
  const transcriptSink = createTranscriptSink({
    transcriptPath,
    platformUrl: config.platformUrl,
    sessionId: config.sessionId,
  });
  // Phase 1 (MCP-inside): start the session's external MCP toolsets (core/mcp/)
  // so a skill's mcp_binding resolves to a native tool call. Non-fatal. MCP
  // lifecycle events are both logged and persisted to the transcript.
  const mcpManager = await createSessionMcpManager(config.root, log, (entry) =>
    transcriptSink.enqueue(entry),
  );
  // Phase 3 (A2A egress): discover remote A2A peers (core/remote-agents/). A
  // member whose agent.yaml has a matching remote_ref is driven over A2A. Non-fatal.
  const a2aConnector = createSessionA2aConnector(config.root, log, (entry) =>
    transcriptSink.enqueue(entry),
  );
  // Phase 2 (CompositeRuntime): wrap the vendor runtime in the dispatch-by-handle
  // adapter. With only the local connector, behavior is byte-identical. The RAW
  // agentRuntime is kept for vendor MCP wiring (buildMcpArgs / writeMcpSettings).
  const runtimeForEngine = new CompositeRuntime(agentRuntime, {
    ...(a2aConnector ? { connectors: { [A2A_CONNECTOR_KIND]: a2aConnector } } : {}),
    resolveKind: (cfg) => {
      if (cfg.remote_ref) {
        if (a2aConnector?.handles(cfg.remote_ref)) return A2A_CONNECTOR_KIND;
        // Declared remote member but no matching remote agent — surface it
        // rather than silently running a different agent locally.
        log(
          `[a2a] WARNING: agent "${cfg.id}" has remote_ref "${cfg.remote_ref}" but no matching ` +
            `aos/remote-agent/v1 was found — running it locally`,
        );
      }
      return LOCAL_CONNECTOR_KIND;
    },
  });
  const workflow = new BaseWorkflow(runtimeForEngine, config.root, {
    toolPolicy: config.toolPolicy,
    transcriptPath,
    mcpToolsetManager: mcpManager ?? undefined,
  });
  const adapter = composeAdapter(runtimeForEngine, eventBus, ui, workflow);
  log("layers composed");

  // ── Agent discovery (flatten nested core/agents layout) ───
  const agentsDir = join(config.root, "core", "agents");
  const agentMap = discoverAgents(agentsDir);
  const flatAgentsDir = createFlatAgentsDir(config.root, agentMap);
  const domainsDir = join(config.root, "core", "domains");
  log(`agents discovered (${agentMap.size})`);

  // ── Engine setup & brief intake ────────────────────────────
  let memory: RuntimeMemoryProvider | null = null;
  try {
    memory = await createRuntimeMemoryProvider(config.root, {
      requireConfiguredProvider: process.env.AOS_REQUIRE_MEMPALACE === "1",
      onWarning: (message) => console.error(`[memory] ${message}`),
    });
  } catch (err) {
    await transcriptSink.shutdown();
    await mcpManager?.shutdown();
    if (a2aConnector) await a2aConnector.abort();
    throw err;
  }
  log(
    `memory provider: ${memory.providerId}` +
      (memory.configuredProvider !== memory.providerId
        ? ` (configured ${memory.configuredProvider})`
        : ""),
  );
  const engine = new AOSEngine(adapter, config.profileDir, {
    agentsDir: flatAgentsDir,
    domain: config.domainName ?? undefined,
    domainDir: config.domainName ? domainsDir : undefined,
    workflowsDir: config.workflowsDir,
    projectDir: config.root,
    memoryProvider: memory.provider,
    autoApprove: config.autoApprove,
    onTranscriptEvent: (entry) => {
      transcriptSink.enqueue(entry);
    },
  });
  try {
    log("starting engine");
    await engine.start(config.briefPath, {
      domain: config.domainName ?? undefined,
      deliberationDir: config.deliberationDir,
    });
    log("engine started");

    if (engine.isWorkflowMode()) {
      const cs = engine.getConstraintState();
      console.log(
        `\nExecution session complete. Rounds: ${cs.rounds_completed}, ` +
          `Cost: $${cs.budget_spent.toFixed(4)}, ` +
          `Time: ${cs.elapsed_minutes.toFixed(1)}min`,
      );
      return;
    }

    // ── Bridge server (MCP tool calls → engine) ────────────────
    // Hashed, length-bounded socket path — long profile ids (e.g.
    // architecture-review) otherwise overflow the unix sun_path cap on a deep
    // macOS $TMPDIR and `listen()` fails.
    const sockPath = bridgeSocketPath(config.sessionId);
    const here = dirname(fileURLToPath(import.meta.url));
    const bridgeScriptPath = join(here, "mcp-arbiter-bridge.ts");

    let halted = false;
    const steerQueue: string[] = [];

    async function waitWhileHalted(): Promise<void> {
      while (halted) await new Promise((r) => setTimeout(r, 200));
    }

    function drainSteer(): string {
      if (steerQueue.length === 0) return "";
      const msgs = steerQueue.splice(0);
      return `\n\n[user steer]\n${msgs.join("\n")}`;
    }

    log(`starting bridge server sock=${sockPath}`);
    const closeBridge = await startBridgeServer(sockPath, {
      delegate: async (params) => {
        await waitWhileHalted();
        const steer = drainSteer();
        const responses = await engine.delegateMessage(
          params.to as any,
          (params.message as string) + steer,
        );
        const cs = engine.getConstraintState();
        process.stdout.write(
          "\n" +
            renderRoundOneLiner({
              round: cs.rounds_completed,
              maxRounds: 8,
              minutes: cs.elapsed_minutes,
              dollars: cs.budget_spent,
            }) +
            "\n",
        );
        return { responses, constraints: cs };
      },
      end: async (params) => {
        await waitWhileHalted();
        const responses = await engine.end(params.closing_message as string);
        return { ok: true, responses };
      },
      aos_recall: async (params) => {
        await waitWhileHalted();
        return engine.recallMemory(params.query as string, {
          agentId: params.agent as string | undefined,
          hall: params.hall as string | undefined,
          maxResults: params.max_results as number | undefined,
        });
      },
      aos_remember: async (params) => {
        await waitWhileHalted();
        const id = await engine.rememberMemory(params.content as string, {
          agentId: (params.agent as string | undefined) ?? "arbiter",
          hall: params.hall as string | undefined,
          source: params.source as string | undefined,
        });
        return { ok: true, id };
      },
    });

    log("bridge listening");
    // ── Arbiter prompt resolution ──────────────────────────────
    const arbiterDir = agentMap.get("arbiter");
    if (!arbiterDir) throw new Error("No arbiter agent found in core/agents/");

    const promptPath = join(arbiterDir, "prompt.md");
    const rawPrompt = readFileSync(promptPath, "utf-8");
    const briefContent = readFileSync(config.briefPath, "utf-8");
    const participants = [...agentMap.keys()].filter((id) => id !== "arbiter");
    const memoPath = join(config.deliberationDir, "memo.md");
    const tools = toolNamesForPlatform(config.platform);

    const templateVars: Record<string, string> = {
      // Spec-compliant underscore names
      session_id: config.sessionId,
      brief_slug: config.sessionId,
      brief: briefContent,
      format: "brief",
      agent_id: "arbiter",
      agent_name: "Arbiter",
      participants: participants.join(", "),
      constraints: "(see constraint state in tool responses)",
      expertise_block: "",
      output_path: memoPath,
      deliberation_dir: config.deliberationDir,
      transcript_path: transcriptPath,
      delegate_tool: tools.delegate,
      end_tool: tools.end,
      recall_tool: tools.recall,
      remember_tool: tools.remember,
      role_override: "",
      // Back-compat hyphenated aliases
      "session-id": config.sessionId,
      "brief-content": briefContent,
      "output-path": memoPath,
      "deliberation-dir": config.deliberationDir,
      "memo-path": memoPath,
    };

    const resolvedPrompt = resolveTemplate(rawPrompt, templateVars);

    const toolPreamble =
      config.platform === "claude-code"
        ? `IMPORTANT — Tool names for this session:\n` +
          `- Where the instructions below say \`delegate(...)\`, call \`${tools.delegate}\` (that is the actual MCP tool name you will see).\n` +
          `- Where they say \`end(...)\`, call \`${tools.end}\`.\n` +
          `- Where they say \`aos_recall(...)\`, call \`${tools.recall}\`.\n` +
          `- Where they say \`aos_remember(...)\`, call \`${tools.remember}\`.\n` +
          `- These are the ONLY AOS tools available to you. Use them exactly as described.\n\n---\n\n`
        : "";
    adapter.setOrchestratorPrompt(toolPreamble + resolvedPrompt);

    const mcpOpts = {
      bridgeScriptPath,
      socketPath: sockPath,
      // Tier 2: expose the session's declared external MCP servers to the arbiter.
      externalServers: mcpManager?.getVendorServerSpecs() ?? [],
    };
    const mcpArgs: string[] =
      (agentRuntime as any).buildMcpArgs?.(mcpOpts) ?? [];

    let restoreGeminiSettings: (() => void) | undefined;
    if ((agentRuntime as any).writeMcpSettings) {
      restoreGeminiSettings = (agentRuntime as any).writeMcpSettings({
        ...mcpOpts,
        projectRoot: config.root,
      });
    }

    const arbiterFlatDir = join(flatAgentsDir, "arbiter");
    const arbiterConfig = loadAgent(arbiterFlatDir);
    arbiterConfig.systemPrompt = resolvedPrompt;

    log("spawning arbiter");
    const arbiterHandle = await adapter.spawnAgent(arbiterConfig, config.sessionId);

    const kickoff =
      "Read the brief below and begin the multi-agent deliberation. " +
      `Use the \`${tools.delegate}\` tool to engage perspective agents and ` +
      `\`${tools.end}\` when ready to wrap up. Use \`${tools.recall}\` when past memory would materially help, and \`${tools.remember}\` to commit important decisions or lessons before closing.\n\n` +
      `---\n\n## Brief\n\n${briefContent}`;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", (input) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      if (trimmed === "/aos-halt") {
        halted = true;
        console.log("Deliberation paused. Type /aos-resume to continue.");
      } else if (trimmed === "/aos-resume") {
        halted = false;
        console.log("Resumed.");
      } else if (trimmed === "/aos-end") {
        steerQueue.push("Please wrap up now and call the end tool.");
      } else if (trimmed === "/aos-status") {
        const cs = engine.getConstraintState();
        console.log(renderTextGauge("TIME", cs.elapsed_minutes, 2, 10, "min"));
        if (cs.metered) {
          console.log(renderTextGauge("BUDGET", cs.budget_spent, 1, 10, "$"));
        }
        console.log(renderTextGauge("ROUNDS", cs.rounds_completed, 2, 8, "rounds"));
      } else if (trimmed.startsWith("/aos-steer ")) {
        steerQueue.push(trimmed.slice("/aos-steer ".length));
      } else if (!trimmed.startsWith("/")) {
        steerQueue.push(trimmed);
      }
    });

    try {
      log(`sending kickoff to arbiter (mcpArgs=${mcpArgs.length})`);
      console.log(
        `\nArbiter running (${config.platform}). ` +
          `Tool calls will stream as rounds complete. ` +
          `Bridge socket: ${sockPath}\n`,
      );
      const printer = createStreamingPrinter();
      const startedAt = Date.now();
      const heartbeat = setInterval(() => {
        if (printer.hasOutput()) return;
        const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
        console.error(
          `[arbiter] waiting for ${config.platform} response... ${elapsedSeconds}s elapsed`,
        );
      }, 15000);
      let response;
      try {
        response = await adapter.sendMessage(arbiterHandle, kickoff, {
          extraArgs: mcpArgs,
          onStream: (partial) => printer.push(partial),
          timeoutMs: config.agentTimeoutMs,
        });
      } finally {
        clearInterval(heartbeat);
      }
      if ((response as any).status !== "success") {
        console.error(
          `\n[arbiter] call failed: status=${(response as any).status} ` +
            `error=${(response as any).error ?? "(none)"}`,
        );
      }
      if (!printer.flushFinal(response.text)) {
        console.log("\n" + response.text);
      }
    } finally {
      rl.close();
      await closeBridge();
      if (restoreGeminiSettings) restoreGeminiSettings();
      const cs = engine.getConstraintState();
      console.log(
        `\nSession complete. Rounds: ${cs.rounds_completed}, ` +
          `Cost: $${cs.budget_spent.toFixed(4)}, ` +
          `Time: ${cs.elapsed_minutes.toFixed(1)}min`,
      );
    }
  } finally {
    await transcriptSink.shutdown();
    await memory?.shutdown();
    await mcpManager?.shutdown();
    if (a2aConnector) await a2aConnector.abort();
  }
}
