import type { BriefKind, BriefSchemaDef } from "./types";

export const DELIBERATION_SCHEMA: BriefSchemaDef = {
  requiredSections: ["Situation", "Stakes", "Constraints", "Key Question"],
  optionalSections: ["Background", "Out of scope"],
  aliases: {},
};

export const EXECUTION_SCHEMA: BriefSchemaDef = {
  requiredSections: ["Feature / Vision", "Context", "Constraints", "Success Criteria"],
  optionalSections: ["Stakeholders", "Out of scope", "Open Questions"],
  aliases: {
    // `dev-execution` frames its first section as "Feature / Change" (feature,
    // bug fix, or refactor of existing code) while `cto-execution` uses
    // "Feature / Vision". Both are valid execution briefs, so accept either.
    "Feature / Vision": ["Vision", "Feature / Change"],
  },
};

export function briefSchema(kind: BriefKind): BriefSchemaDef {
  return kind === "deliberation" ? DELIBERATION_SCHEMA : EXECUTION_SCHEMA;
}

export const DISCRIMINATING_HEADINGS: Record<BriefKind, string> = {
  deliberation: "Key Question",
  execution: "Success Criteria",
};
