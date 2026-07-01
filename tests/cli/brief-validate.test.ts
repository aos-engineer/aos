import { describe, expect, test } from "bun:test";
import { validateBrief } from "../../cli/src/brief/validate";

const minimalDeliberation = `# Brief: Test
## Situation
S
## Stakes
T
## Constraints
C
## Key Question
Q?`;

describe("validateBrief - title", () => {
  test("errors when title H1 missing", () => {
    const r = validateBrief("## Situation\n\nx", { expectedKind: "deliberation" });
    expect(r.errors.some((e) => e.kind === "missing-title")).toBe(true);
  });

  test("accepts `# Brief: ` H1", () => {
    const r = validateBrief(minimalDeliberation, { expectedKind: "deliberation" });
    expect(r.errors.some((e) => e.kind === "missing-title")).toBe(false);
  });
});

describe("validateBrief - required sections", () => {
  test("errors when Key Question missing on deliberation", () => {
    const r = validateBrief(`# Brief: T\n## Situation\nx\n## Stakes\nx\n## Constraints\nx`, { expectedKind: "deliberation" });
    expect(r.errors.find((e) => e.kind === "missing-required" && e.section === "Key Question")).toBeDefined();
  });

  test("errors when Success Criteria missing on execution", () => {
    const r = validateBrief(`# Brief: T\n## Feature / Vision\nx\n## Context\nx\n## Constraints\nx`, { expectedKind: "execution" });
    expect(r.errors.find((e) => e.kind === "missing-required" && e.section === "Success Criteria")).toBeDefined();
  });

  test("`## Vision` accepted as alias of `## Feature / Vision`", () => {
    const r = validateBrief(`# Brief: T\n## Vision\nv\n## Context\nx\n## Constraints\nx\n## Success Criteria\nx`, { expectedKind: "execution" });
    expect(r.errors.find((e) => e.section === "Feature / Vision")).toBeUndefined();
  });

  test("`## Feature / Change` (dev-execution) accepted as alias of `## Feature / Vision`", () => {
    // dev-execution's profile uses `## Feature / Change`; a correct brief for it
    // must not trip the execution-brief linter.
    const brief = `# Brief: T\n## Feature / Change\nc\n## Context\nx\n## Constraints\nx\n## Success Criteria\nx`;
    const r = validateBrief(brief, { expectedKind: "execution" });
    expect(r.errors).toEqual([]);
    // And it auto-detects as execution without an explicit kind.
    expect(validateBrief(brief).detectedKind).toBe("execution");
  });

  test("heading match is case-insensitive", () => {
    const r = validateBrief(`# Brief: T\n## SITUATION\nx\n## stakes\nx\n## CONSTRAINTS\nx\n## key question\nx`, { expectedKind: "deliberation" });
    expect(r.errors.filter((e) => e.kind === "missing-required")).toHaveLength(0);
  });
});

describe("validateBrief - empty section detection", () => {
  test("section with only whitespace flagged as empty (warning by default)", () => {
    const r = validateBrief(`# Brief: T\n## Situation\n\n   \n\n## Stakes\nS\n## Constraints\nC\n## Key Question\nQ`, { expectedKind: "deliberation" });
    expect(r.warnings.find((w) => w.kind === "empty-section" && w.section === "Situation")).toBeDefined();
    expect(r.errors.find((e) => e.section === "Situation")).toBeUndefined();
  });

  test("section with only HTML comment flagged as empty", () => {
    const r = validateBrief(`# Brief: T\n## Situation\n<!-- TODO: write -->\n## Stakes\nS\n## Constraints\nC\n## Key Question\nQ`, { expectedKind: "deliberation" });
    expect(r.warnings.find((w) => w.section === "Situation")).toBeDefined();
  });

  test("strict mode upgrades empty-section warning to error", () => {
    const r = validateBrief(`# Brief: T\n## Situation\n\n## Stakes\nS\n## Constraints\nC\n## Key Question\nQ`, { expectedKind: "deliberation", strict: true });
    expect(r.errors.find((e) => e.kind === "empty-section" && e.section === "Situation")).toBeDefined();
    expect(r.warnings.find((w) => w.section === "Situation")).toBeUndefined();
  });
});

describe("validateBrief - shape mismatch hint", () => {
  test("execution profile + brief with Key Question gets a deliberation hint", () => {
    const r = validateBrief(`# Brief: T\n## Situation\ns\n## Stakes\nx\n## Key Question\nQ?`, { expectedKind: "execution" });
    expect(r.errors.find((e) => e.message.includes("looks shaped for `deliberation`"))).toBeDefined();
  });

  test("no hint when only one missing-required", () => {
    const r = validateBrief(`# Brief: T\n## Feature / Vision\nv\n## Context\nc\n## Constraints\nc`, { expectedKind: "execution" });
    expect(r.errors.find((e) => e.message.includes("looks shaped"))).toBeUndefined();
  });
});

describe("validateBrief - auto-detect kind", () => {
  test("returns deliberation when deliberation requireds present", () => {
    const r = validateBrief(`# Brief: T\n## Situation\ns\n## Stakes\nx\n## Constraints\nc\n## Key Question\nQ?`);
    expect(r.detectedKind).toBe("deliberation");
  });

  test("returns null with auto-detect-failed when fewer than 2 requireds present in either kind", () => {
    const r = validateBrief(`# Brief: T\n## Constraints\nc`);
    expect(r.detectedKind).toBeNull();
    expect(r.errors.find((e) => e.kind === "auto-detect-failed")).toBeDefined();
  });

  test("returns null on low-confidence tied scores", () => {
    const r = validateBrief(`# Brief: T\n## Situation\ns\n## Constraints\nc\n## Context\nx`);
    expect(r.detectedKind).toBeNull();
    expect(r.errors.find((e) => e.kind === "auto-detect-failed")).toBeDefined();
  });
});
