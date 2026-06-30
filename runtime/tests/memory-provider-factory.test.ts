import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeMemoryProvider } from "../src/memory-provider-factory";

function makeProject(memoryYaml: string): string {
  const projectDir = mkdtempSync(join(tmpdir(), "aos-memory-provider-"));
  mkdirSync(join(projectDir, ".aos"), { recursive: true });
  writeFileSync(join(projectDir, ".aos", "memory.yaml"), memoryYaml);
  return projectDir;
}

const mempalaceYaml = `api_version: aos/memory/v1
provider: mempalace
mempalace:
  palace_path: ~/.mempalace/palace
  project_wing: test-wing
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`;

describe("createRuntimeMemoryProvider", () => {
  it("creates a MemPalace provider when the configured MCP process starts", async () => {
    const projectDir = makeProject(mempalaceYaml);
    const memory = await createRuntimeMemoryProvider(projectDir, {
      mempalaceCommand: process.execPath,
      mempalaceArgs: ["-e", "setInterval(() => {}, 1000);"],
    });

    try {
      expect(memory.providerId).toBe("mempalace");
      expect(memory.configuredProvider).toBe("mempalace");
      expect(memory.provider.id).toBe("mempalace");
    } finally {
      await memory.shutdown();
    }
  });

  it("falls back to expertise when MemPalace is unavailable by default", async () => {
    const projectDir = makeProject(mempalaceYaml);
    const warnings: string[] = [];

    const memory = await createRuntimeMemoryProvider(projectDir, {
      mempalaceCommand: process.execPath,
      mempalaceArgs: ["-e", "process.exit(1);"],
      onWarning: (message) => warnings.push(message),
    });

    expect(memory.providerId).toBe("expertise");
    expect(memory.configuredProvider).toBe("mempalace");
    expect(memory.provider.id).toBe("expertise");
    expect(warnings[0]).toContain("Falling back");
    await memory.shutdown();
  });

  it("throws in strict mode when configured MemPalace is unavailable", async () => {
    const projectDir = makeProject(mempalaceYaml);

    await expect(
      createRuntimeMemoryProvider(projectDir, {
        mempalaceCommand: process.execPath,
        mempalaceArgs: ["-e", "process.exit(1);"],
        requireConfiguredProvider: true,
      }),
    ).rejects.toThrow("MemPalace provider configured but unavailable");
  });
});

const graphifyYaml = `api_version: aos/memory/v1
provider: graphify
graphify:
  corpus_path: .aos/graphify/corpus
  graph_path: graphify-out/graph.json
  auto_build: false
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`;

describe("createRuntimeMemoryProvider (graphify)", () => {
  it("creates a Graphify provider when the configured MCP process starts", async () => {
    const projectDir = makeProject(graphifyYaml);
    const memory = await createRuntimeMemoryProvider(projectDir, {
      graphifyCommand: process.execPath,
      graphifyArgs: ["-e", "setInterval(() => {}, 1000);"],
    });

    try {
      expect(memory.providerId).toBe("graphify");
      expect(memory.configuredProvider).toBe("graphify");
      expect(memory.provider.id).toBe("graphify");
    } finally {
      await memory.shutdown();
    }
  });

  it("falls back to expertise when graphify is unavailable by default", async () => {
    const projectDir = makeProject(graphifyYaml);
    const warnings: string[] = [];

    const memory = await createRuntimeMemoryProvider(projectDir, {
      graphifyCommand: process.execPath,
      graphifyArgs: ["-e", "process.exit(1);"],
      onWarning: (message) => warnings.push(message),
    });

    expect(memory.providerId).toBe("expertise");
    expect(memory.configuredProvider).toBe("graphify");
    expect(memory.provider.id).toBe("expertise");
    expect(warnings[0]).toContain("Falling back");
    await memory.shutdown();
  });

  it("throws in strict mode when configured graphify is unavailable", async () => {
    const projectDir = makeProject(graphifyYaml);

    await expect(
      createRuntimeMemoryProvider(projectDir, {
        graphifyCommand: process.execPath,
        graphifyArgs: ["-e", "process.exit(1);"],
        requireConfiguredProvider: true,
      }),
    ).rejects.toThrow("Graphify provider configured but unavailable");
  });
});
