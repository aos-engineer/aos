// runtime/tests/memory-config.test.ts
import { describe, it, expect } from "bun:test";
import { loadMemoryConfig, MemoryConfigError } from "../src/memory-config";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "aos-mem-test-"));
}

describe("loadMemoryConfig", () => {
  it("returns default expertise config when no memory.yaml exists", () => {
    const dir = makeTempDir();
    const config = loadMemoryConfig(dir);
    expect(config.provider).toBe("expertise");
    expect(config.orchestrator.recallGate).toBe(true);
    expect(config.orchestrator.maxRecallPerSession).toBe(10);
    expect(config.orchestrator.rememberPrompt).toBe("session_end");
  });

  it("loads a valid mempalace config", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: mempalace
mempalace:
  palace_path: ~/.mempalace/palace
  project_wing: test-project
  wake_layers: [L0, L1]
  auto_hall: true
  max_wake_tokens: 800
  max_drawer_tokens: 300
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 5
`,
    );
    const config = loadMemoryConfig(dir);
    expect(config.provider).toBe("mempalace");
    expect(config.mempalace!.palacePath).toBe("~/.mempalace/palace");
    expect(config.mempalace!.maxWakeTokens).toBe(800);
    expect(config.mempalace!.maxDrawerTokens).toBe(300);
    expect(config.orchestrator.maxRecallPerSession).toBe(5);
  });

  it("loads a valid expertise config", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: expertise
expertise:
  max_lines: 150
  scope: global
orchestrator:
  remember_prompt: per_round
  recall_gate: false
  max_recall_per_session: 20
`,
    );
    const config = loadMemoryConfig(dir);
    expect(config.provider).toBe("expertise");
    expect(config.expertise!.maxLines).toBe(150);
    expect(config.expertise!.scope).toBe("global");
    expect(config.orchestrator.rememberPrompt).toBe("per_round");
  });

  it("applies defaults for missing mempalace fields", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: mempalace
mempalace:
  palace_path: ~/.mempalace/palace
  project_wing: my-proj
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`,
    );
    const config = loadMemoryConfig(dir);
    expect(config.mempalace!.wakeLayers).toEqual(["L0", "L1"]);
    expect(config.mempalace!.autoHall).toBe(true);
    expect(config.mempalace!.maxWakeTokens).toBe(1200);
    expect(config.mempalace!.maxDrawerTokens).toBe(500);
  });

  it("loads a graphify config and applies defaults", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: graphify
graphify:
  corpus_path: .aos/graphify/corpus
  auto_build: true
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`,
    );
    const config = loadMemoryConfig(dir);
    expect(config.provider).toBe("graphify");
    expect(config.graphify!.corpusPath).toBe(".aos/graphify/corpus");
    expect(config.graphify!.autoBuild).toBe(true);
    // defaults
    expect(config.graphify!.graphPath).toBe("graphify-out/graph.json");
    expect(config.graphify!.mcpCommand).toBe("graphify-mcp");
    expect(config.graphify!.maxWakeTokens).toBe(1200);
    expect(config.graphify!.maxRecallResults).toBe(8);
  });

  it("populates graphify defaults even with no graphify block", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: graphify
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`,
    );
    const config = loadMemoryConfig(dir);
    expect(config.graphify!.corpusPath).toBe(".aos/graphify/corpus");
    expect(config.graphify!.autoBuild).toBe(false);
  });

  it("throws MemoryConfigError for invalid api_version", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v99
provider: mempalace
`,
    );
    expect(() => loadMemoryConfig(dir)).toThrow(MemoryConfigError);
  });

  it("throws MemoryConfigError for invalid provider value", () => {
    const dir = makeTempDir();
    const aosDir = join(dir, ".aos");
    mkdirSync(aosDir, { recursive: true });
    writeFileSync(
      join(aosDir, "memory.yaml"),
      `api_version: aos/memory/v1
provider: invalid
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
`,
    );
    expect(() => loadMemoryConfig(dir)).toThrow(MemoryConfigError);
  });
});
