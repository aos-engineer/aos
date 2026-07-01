import { describe, expect, test } from "bun:test";
import {
  briefSchema,
  DELIBERATION_SCHEMA,
  EXECUTION_SCHEMA,
  DISCRIMINATING_HEADINGS,
} from "../../cli/src/brief/schema";

describe("briefSchema", () => {
  test("deliberation schema has the four required sections", () => {
    expect(DELIBERATION_SCHEMA.requiredSections).toEqual([
      "Situation",
      "Stakes",
      "Constraints",
      "Key Question",
    ]);
  });

  test("execution schema has the four required sections", () => {
    expect(EXECUTION_SCHEMA.requiredSections).toEqual([
      "Feature / Vision",
      "Context",
      "Constraints",
      "Success Criteria",
    ]);
  });

  test("execution schema declares Vision and Feature / Change as aliases for Feature / Vision", () => {
    expect(EXECUTION_SCHEMA.aliases["Feature / Vision"]).toEqual(["Vision", "Feature / Change"]);
  });

  test("deliberation schema has no aliases", () => {
    expect(DELIBERATION_SCHEMA.aliases).toEqual({});
  });

  test("briefSchema() returns the matching schema by kind", () => {
    expect(briefSchema("deliberation")).toBe(DELIBERATION_SCHEMA);
    expect(briefSchema("execution")).toBe(EXECUTION_SCHEMA);
  });

  test("DISCRIMINATING_HEADINGS maps each kind to its unique required heading", () => {
    expect(DISCRIMINATING_HEADINGS.deliberation).toBe("Key Question");
    expect(DISCRIMINATING_HEADINGS.execution).toBe("Success Criteria");
  });
});
