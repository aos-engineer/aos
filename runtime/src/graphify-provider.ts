// runtime/src/graphify-provider.ts
//
// Graphify memory provider. Graphify (https://graphifylabs.ai) turns a corpus
// into a queryable knowledge graph and serves it over an MCP stdio server
// (query-only: query_graph, graph_stats, ...). This provider maps:
//   recall / wake  -> MCP query_graph
//   status         -> MCP graph_stats
//   remember       -> write a markdown note into the corpus dir, then (optionally)
//                     rebuild the graph via the `graphify build` CLI (best-effort)
// Ingestion is corpus + CLI based, so the MCP server only serves an already-built
// graph; the factory falls back to the built-in expertise provider when no graph
// is available yet.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { McpClient } from "./mcp-client";
import type {
  MemoryProvider,
  MemoryConfig,
  GraphifyConfig,
  HealthStatus,
  WakeContext,
  RecallOpts,
  RecallResult,
  RecallEntry,
  RememberOpts,
  RememberId,
  MemoryStatus,
} from "./memory-provider";

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sanitizeSegment(s: string): string {
  return (s || "default").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
}

export interface BuildResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs the `graphify build` CLI. Injectable so tests need no real graphify. */
export type GraphifyBuildRunner = (
  command: string,
  args: string[],
  cwd?: string,
) => Promise<BuildResult>;

const defaultBuildRunner: GraphifyBuildRunner = (command, args, cwd) =>
  new Promise<BuildResult>((resolve, reject) => {
    let proc;
    try {
      proc = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      reject(e);
      return;
    }
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
  });

export class GraphifyProvider implements MemoryProvider {
  readonly id = "graphify";
  readonly name = "Graphify";

  private client: McpClient;
  private config!: GraphifyConfig;
  private buildRunner: GraphifyBuildRunner;

  constructor(client: McpClient, deps: { buildRunner?: GraphifyBuildRunner } = {}) {
    this.client = client;
    this.buildRunner = deps.buildRunner ?? defaultBuildRunner;
  }

  async initialize(config: MemoryConfig): Promise<void> {
    if (!config.graphify) {
      throw new Error("GraphifyProvider requires graphify config");
    }
    this.config = config.graphify;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return (await this.client.healthCheck()).healthy;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    return this.client.healthCheck();
  }

  async wake(projectId: string, agentId?: string): Promise<WakeContext> {
    const query = `Summarize the most important facts, decisions, and structure for "${projectId}"${
      agentId ? ` relevant to the ${agentId} role` : ""
    }.`;

    let answer = "";
    try {
      answer = await this.queryGraph(query, this.config.maxRecallResults);
    } catch {
      answer = "";
    }

    const maxChars = this.config.maxWakeTokens * 4;
    let truncated = false;
    let essentials = answer;
    if (essentials.length > maxChars) {
      essentials = essentials.slice(0, maxChars);
      truncated = true;
    }

    return {
      identity: `${projectId}${agentId ? `/${agentId}` : ""}`,
      essentials,
      tokenEstimate: estimateTokens(essentials),
      truncated,
    };
  }

  async recall(query: string, opts: RecallOpts): Promise<RecallResult> {
    const answer = await this.queryGraph(query, opts.maxResults ?? this.config.maxRecallResults);
    if (!answer.trim()) {
      return { entries: [], tokenEstimate: 0 };
    }

    const entry: RecallEntry = {
      content: answer,
      wing: opts.projectId,
      room: opts.agentId ?? "",
      hall: opts.hall ?? "graph",
      similarity: 1,
    };

    return { entries: [entry], tokenEstimate: estimateTokens(answer) };
  }

  async remember(content: string, opts: RememberOpts): Promise<RememberId> {
    const dir = join(this.config.corpusPath, sanitizeSegment(opts.projectId), sanitizeSegment(opts.agentId));
    mkdirSync(dir, { recursive: true });

    const timestamp = new Date().toISOString();
    const id = randomUUID();
    const file = join(dir, `${timestamp.replace(/[:.]/g, "-")}-${id.slice(0, 8)}.md`);

    const frontmatter = [
      "---",
      `agent: ${opts.agentId}`,
      `project: ${opts.projectId}`,
      `hall: ${opts.hall ?? "hall_facts"}`,
      opts.source ? `source: ${opts.source}` : null,
      opts.sessionId ? `session: ${opts.sessionId}` : null,
      `timestamp: ${timestamp}`,
      "---",
      "",
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    writeFileSync(file, `${frontmatter}${content}\n`, "utf-8");

    if (this.config.autoBuild) {
      try {
        await this.buildRunner(this.config.buildCommand, ["build", this.config.corpusPath]);
      } catch {
        // Best-effort: the note is persisted; the next successful build picks it up.
      }
    }

    return file;
  }

  async status(): Promise<MemoryStatus> {
    if (!(await this.isAvailable())) {
      return { provider: "graphify", available: false };
    }
    try {
      const raw = await this.callToolWithRecovery("graph_stats", {});
      const parsed = this.parseJsonContent(raw);
      const nodes = typeof parsed.nodes === "number" ? parsed.nodes : undefined;
      return { provider: "graphify", available: true, drawerCount: nodes };
    } catch {
      return { provider: "graphify", available: false };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private async queryGraph(query: string, maxResults: number): Promise<string> {
    const raw = await this.callToolWithRecovery("query_graph", {
      query,
      max_results: maxResults,
    });
    return this.parseTextContent(raw);
  }

  private async callToolWithRecovery(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.client.call("tools/call", { name: toolName, arguments: args });
    } catch (firstError) {
      try {
        await this.client.restart();
        return await this.client.call("tools/call", { name: toolName, arguments: args });
      } catch {
        throw firstError;
      }
    }
  }

  /** Join all TextContent blocks from an MCP tool result. */
  private parseTextContent(raw: unknown): string {
    if (!raw || typeof raw !== "object") return "";
    const result = raw as { content?: Array<{ text?: string }> };
    if (!Array.isArray(result.content)) return "";
    return result.content
      .map((c) => c.text ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  /** Parse the first TextContent block as JSON (for graph_stats). */
  private parseJsonContent(raw: unknown): Record<string, unknown> {
    const text = this.parseTextContent(raw);
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
