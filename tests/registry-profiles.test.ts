// Bug 1: cto-execution (and dev-execution) must be registered in registry.json,
// with an agent_count that matches the actual profile assembly on disk.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile } from "../runtime/src/config-loader";

const repoRoot = join(import.meta.dir, "..");
const registry = JSON.parse(
  readFileSync(join(repoRoot, "registry", "registry.json"), "utf-8"),
);
const profilesById: Record<string, any> = Object.fromEntries(
  registry.profiles.map((p: any) => [p.id, p]),
);

function expectedAgentCount(profileId: string): number {
  const profile = loadProfile(join(repoRoot, "core", "profiles", profileId));
  return 1 /* orchestrator */ + profile.assembly.perspectives.length;
}

describe("registry execution profiles", () => {
  for (const id of ["aos/cto-execution", "aos/dev-execution"]) {
    test(`${id} is registered`, () => {
      expect(profilesById[id]).toBeDefined();
    });

    test(`${id} agent_count matches its assembly`, () => {
      const bare = id.replace(/^aos\//, "");
      expect(profilesById[id].agent_count).toBe(expectedAgentCount(bare));
    });
  }

  test("all registered profiles carry the required, valid fields", () => {
    const semver = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
    for (const p of registry.profiles) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(typeof p.author).toBe("string");
      expect(p.description.length).toBeLessThanOrEqual(200);
      expect(Number.isInteger(p.agent_count) && p.agent_count >= 1).toBe(true);
      expect(Array.isArray(p.tags) && p.tags.length >= 1).toBe(true);
      expect(semver.test(p.version)).toBe(true);
    }
  });
});
