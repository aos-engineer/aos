import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphifyProvider, type GraphifyBuildRunner } from "../src/graphify-provider";
import type { MemoryConfig, HealthStatus } from "../src/memory-provider";
import type { McpClient } from "../src/mcp-client";

function createMockClient(
  overrides: { healthy?: boolean } = {},
): McpClient & { _callLog: Array<{ method: string; params: unknown }> } {
  const callLog: Array<{ method: string; params: unknown }> = [];
  return {
    _callLog: callLog,
    isRunning: () => true,
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    call: async (method: string, params?: Record<string, unknown>) => {
      callLog.push({ method, params: params ?? {} });
      if (method === "tools/call" && params?.name === "query_graph") {
        return {
          content: [{ text: "The auth module depends on the session store and the JWT signer." }],
        };
      }
      if (method === "tools/call" && params?.name === "graph_stats") {
        return {
          content: [{ text: JSON.stringify({ nodes: 120, edges: 340, communities: 8 }) }],
        };
      }
      return {};
    },
    healthCheck: async (): Promise<HealthStatus> => ({
      healthy: overrides.healthy ?? true,
      latencyMs: 5,
    }),
  } as unknown as McpClient & { _callLog: Array<{ method: string; params: unknown }> };
}

function makeConfig(corpusPath: string, autoBuild = true): MemoryConfig {
  return {
    provider: "graphify",
    graphify: {
      corpusPath,
      graphPath: "graphify-out/graph.json",
      mcpCommand: "graphify-mcp",
      buildCommand: "graphify",
      autoBuild,
      maxWakeTokens: 1200,
      maxRecallResults: 8,
    },
    orchestrator: { rememberPrompt: "session_end", recallGate: true, maxRecallPerSession: 10 },
  };
}

let corpus: string;
beforeEach(() => {
  corpus = mkdtempSync(join(tmpdir(), "graphify-corpus-"));
});

describe("GraphifyProvider", () => {
  it("identifies as graphify", () => {
    const p = new GraphifyProvider(createMockClient());
    expect(p.id).toBe("graphify");
    expect(p.name).toBe("Graphify");
  });

  it("initialize() requires graphify config", async () => {
    const p = new GraphifyProvider(createMockClient());
    await expect(
      p.initialize({ provider: "graphify", orchestrator: { rememberPrompt: "session_end", recallGate: true, maxRecallPerSession: 10 } }),
    ).rejects.toThrow();
  });

  it("recall() queries the graph and returns the answer as an entry", async () => {
    const client = createMockClient();
    const p = new GraphifyProvider(client);
    await p.initialize(makeConfig(corpus));

    const res = await p.recall("what depends on auth?", { projectId: "proj", agentId: "architect" });
    expect(res.entries.length).toBe(1);
    expect(res.entries[0].content).toContain("auth module depends");
    expect(res.tokenEstimate).toBeGreaterThan(0);

    const queryCall = client._callLog.find(
      (c) => c.method === "tools/call" && (c.params as any)?.name === "query_graph",
    );
    expect(queryCall).toBeDefined();
    expect((queryCall!.params as any).arguments.query).toBe("what depends on auth?");
  });

  it("wake() returns bounded graph context", async () => {
    const p = new GraphifyProvider(createMockClient());
    await p.initialize(makeConfig(corpus));
    const wake = await p.wake("proj", "architect");
    expect(wake.identity).toBe("proj/architect");
    expect(wake.essentials).toContain("auth module depends");
    expect(wake.tokenEstimate).toBeGreaterThan(0);
  });

  it("wake() truncates when over the token budget", async () => {
    const client = createMockClient();
    // long answer
    (client as any).call = async (method: string, params?: Record<string, unknown>) => {
      if (method === "tools/call") return { content: [{ text: "x ".repeat(5000) }] };
      return {};
    };
    const p = new GraphifyProvider(client);
    const cfg = makeConfig(corpus);
    cfg.graphify!.maxWakeTokens = 50;
    await p.initialize(cfg);
    const wake = await p.wake("proj");
    expect(wake.truncated).toBe(true);
    expect(wake.tokenEstimate).toBeLessThanOrEqual(50);
  });

  it("remember() writes a corpus note and returns its path", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const buildRunner: GraphifyBuildRunner = async (command, args) => {
      calls.push({ command, args });
      return { exitCode: 0, stdout: "built", stderr: "" };
    };
    const p = new GraphifyProvider(createMockClient(), { buildRunner });
    await p.initialize(makeConfig(corpus, true));

    const id = await p.remember("We chose Postgres over DynamoDB.", {
      projectId: "proj",
      agentId: "architect",
      hall: "hall_decisions",
      source: "session-1.jsonl",
    });

    expect(existsSync(id)).toBe(true);
    const written = readFileSync(id, "utf-8");
    expect(written).toContain("We chose Postgres over DynamoDB.");
    expect(written).toContain("architect");
    // auto_build true => build invoked
    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe("graphify");
    expect(calls[0].args).toContain("build");
  });

  it("remember() does not build when auto_build is false", async () => {
    const calls: string[] = [];
    const buildRunner: GraphifyBuildRunner = async (command) => {
      calls.push(command);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const p = new GraphifyProvider(createMockClient(), { buildRunner });
    await p.initialize(makeConfig(corpus, false));
    const id = await p.remember("note", { projectId: "proj", agentId: "operator" });
    expect(existsSync(id)).toBe(true);
    expect(calls.length).toBe(0);
  });

  it("remember() still returns the note path when the build fails (best-effort)", async () => {
    const buildRunner: GraphifyBuildRunner = async () => {
      throw new Error("graphify not installed");
    };
    const p = new GraphifyProvider(createMockClient(), { buildRunner });
    await p.initialize(makeConfig(corpus, true));
    const id = await p.remember("note", { projectId: "proj", agentId: "operator" });
    expect(existsSync(id)).toBe(true);
  });

  it("status() reports graph stats when available", async () => {
    const p = new GraphifyProvider(createMockClient());
    await p.initialize(makeConfig(corpus));
    const status = await p.status();
    expect(status.provider).toBe("graphify");
    expect(status.available).toBe(true);
    expect(status.drawerCount).toBe(120);
  });

  it("status() reports unavailable when the server is down", async () => {
    const p = new GraphifyProvider(createMockClient({ healthy: false }));
    await p.initialize(makeConfig(corpus));
    const status = await p.status();
    expect(status.available).toBe(false);
  });

  it("isAvailable() reflects health", async () => {
    expect(await new GraphifyProvider(createMockClient({ healthy: true })).isAvailable()).toBe(true);
    expect(await new GraphifyProvider(createMockClient({ healthy: false })).isAvailable()).toBe(false);
  });
});
