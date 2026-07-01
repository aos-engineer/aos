/**
 * Config Loader — loads and validates YAML config files.
 * Uses js-yaml for parsing.
 * See spec Sections 3.1, 4.1, 5.1 for schemas.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import yaml from "js-yaml";
import type { AgentConfig, ProfileConfig, DomainConfig, InputSection, SkillConfig, McpRegistryConfig, RemoteAgentConfig } from "./types";
import type { WorkflowConfig } from "./workflow-runner";
import { parseToolsBlock } from "./profile-schema";
import { validateAgainstSchema } from "./schema-validator";

export class ConfigError extends Error {
  constructor(message: string, public path: string) {
    super(`Config error in ${path}: ${message}`);
    this.name = "ConfigError";
  }
}

function validateId(id: string, path: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new ConfigError(`Invalid ID "${id}" — must be lowercase alphanumeric with hyphens`, path);
  }
}

/**
 * Phase 0 (carrying capacity): run the ACTUAL JSON Schema via ajv.
 *   mode "strict" → throw (used for new kinds, e.g. aos/mcp/v1)
 *   mode "warn"   → console.warn (legacy kinds — surface drift, don't break)
 * No-ops silently when the schema file can't be located (e.g. published runtime
 * without core/schema/); the loaders' manual checks remain the floor.
 */
function enforceSchema(
  schemaId: string,
  config: unknown,
  yamlPath: string,
  mode: "strict" | "warn",
): void {
  const res = validateAgainstSchema(schemaId, config, dirname(yamlPath));
  if (!res.checked || res.ok) return;
  const detail = res.errors.slice(0, 5).join("; ");
  if (mode === "strict") {
    throw new ConfigError(`does not satisfy ${schemaId}: ${detail}`, yamlPath);
  }
  console.warn(`WARNING: ${yamlPath} does not satisfy ${schemaId}: ${detail}`);
}

export function loadAgent(agentDir: string): AgentConfig {
  const yamlPath = join(agentDir, "agent.yaml");
  const promptPath = join(agentDir, "prompt.md");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("agent.yaml not found", agentDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as AgentConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("agent.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/agent/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/agent/v1"`,
      yamlPath,
    );
  }

  const required = ["id", "name", "role", "cognition", "persona", "model"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  validateId(config.id, yamlPath);

  if (existsSync(promptPath)) {
    config.systemPrompt = readFileSync(promptPath, "utf-8");
  }

  config.tensions = config.tensions || [];
  config.tools = config.tools ?? null;
  config.skills = config.skills || [];
  config.expertise = config.expertise || [];

  enforceSchema("aos/agent/v1", config, yamlPath, "warn");
  return config;
}

export function loadProfile(profileDir: string): ProfileConfig {
  const yamlPath = join(profileDir, "profile.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("profile.yaml not found", profileDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as ProfileConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("profile.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/profile/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/profile/v1"`,
      yamlPath,
    );
  }

  const required = ["id", "name", "assembly", "constraints", "input", "output"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  validateId(config.id, yamlPath);

  // Expertise concurrency warning (spec Section 6.9)
  if (config.expertise?.mode === "shared") {
    console.warn(
      "WARNING: Profile uses shared expertise mode. Concurrent agent writes may conflict during parallel dispatch.",
    );
  }

  // Parse optional workflow field
  config.workflow = config.workflow ?? null;
  config.runtime_requirements = {
    serve: config.runtime_requirements?.serve ?? false,
    channels: config.runtime_requirements?.channels ?? false,
    mempalace: config.runtime_requirements?.mempalace ?? false,
    a2a_serve: config.runtime_requirements?.a2a_serve ?? false,
  };

  // Parse optional tools block (spec D3.1). Malformed → throw (caller surfaces as exit 3).
  try {
    config.tools = parseToolsBlock((config as any).tools);
  } catch (e) {
    throw new ConfigError((e as Error).message, yamlPath);
  }

  // Ensure role_override is preserved on perspective entries
  if (config.assembly?.perspectives) {
    for (const p of config.assembly.perspectives) {
      p.role_override = p.role_override ?? null;
    }
  }

  enforceSchema("aos/profile/v1", config, yamlPath, "warn");
  return config;
}

export function loadDomain(domainDir: string): DomainConfig {
  const yamlPath = join(domainDir, "domain.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("domain.yaml not found", domainDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as DomainConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("domain.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/domain/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/domain/v1"`,
      yamlPath,
    );
  }

  if (config.id) {
    validateId(config.id, yamlPath);
  }

  config.overlays = config.overlays || {};
  config.additional_input_sections = config.additional_input_sections || [];
  config.additional_output_sections = config.additional_output_sections || [];
  config.guardrails = config.guardrails || [];

  enforceSchema("aos/domain/v1", config, yamlPath, "warn");
  return config;
}

export interface BriefValidation {
  valid: boolean;
  content: string;
  missing: InputSection[];
}

export function loadWorkflow(workflowDir: string): WorkflowConfig {
  // Support both a directory containing workflow.yaml and a direct yaml file path
  let yamlPath: string;
  if (workflowDir.endsWith(".yaml") || workflowDir.endsWith(".yml")) {
    yamlPath = workflowDir;
  } else {
    yamlPath = join(workflowDir, "workflow.yaml");
  }

  if (!existsSync(yamlPath)) {
    throw new ConfigError("workflow.yaml not found", workflowDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as WorkflowConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("workflow.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/workflow/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/workflow/v1"`,
      yamlPath,
    );
  }

  // description and gates are optional; provide defaults
  config.description = config.description || "";
  config.gates = config.gates || [];

  const required = ["id", "name", "steps"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  if (!Array.isArray(config.steps) || config.steps.length === 0) {
    throw new ConfigError("Workflow must have at least one step", yamlPath);
  }

  // Apply defaults for optional step fields
  for (const step of config.steps) {
    step.input = step.input || [];
    step.review_gate = step.review_gate ?? false;
  }

  // Validate tension-pair steps have exactly 2 agents
  for (const step of config.steps) {
    if (step.action === "tension-pair") {
      if (!step.agents || step.agents.length !== 2) {
        throw new ConfigError(
          `Step "${step.id}" with action "tension-pair" must have exactly 2 agents`,
          yamlPath,
        );
      }
    }
  }

  // Validate artifact ID (output) uniqueness
  const outputIds = new Set<string>();
  for (const step of config.steps) {
    if (step.output) {
      if (outputIds.has(step.output)) {
        throw new ConfigError(
          `Duplicate artifact output ID "${step.output}" found in step "${step.id}"`,
          yamlPath,
        );
      }
      outputIds.add(step.output);
    }
  }

  // Validate step references in gates
  const stepIds = new Set(config.steps.map((s) => s.id));
  for (const gate of config.gates) {
    if (!stepIds.has(gate.after)) {
      throw new ConfigError(
        `Gate references unknown step "${gate.after}"`,
        yamlPath,
      );
    }
    // Validate gate references a step with review_gate: true
    const targetStep = config.steps.find((s) => s.id === gate.after);
    if (targetStep && !targetStep.review_gate) {
      throw new ConfigError(
        `Gate after "${gate.after}" references a step without review_gate: true`,
        yamlPath,
      );
    }
  }

  // Validate step input references using dual resolution:
  // 1. Check output IDs first (only from preceding steps — no forward references)
  // 2. Fall back to step IDs of preceding steps (backward compatibility)
  const precedingOutputIds = new Set<string>();
  const precedingStepIds = new Set<string>();
  for (const step of config.steps) {
    for (const inputRef of step.input!) {
      if (precedingOutputIds.has(inputRef)) {
        // Resolved as an artifact output ID from a preceding step
        continue;
      }
      if (precedingStepIds.has(inputRef)) {
        // Backward-compatible: resolved as a preceding step ID
        continue;
      }
      // Check if the reference exists at all (for a better error message)
      if (outputIds.has(inputRef) || stepIds.has(inputRef)) {
        throw new ConfigError(
          `Step "${step.id}" has forward reference to "${inputRef}" which is defined in a later step`,
          yamlPath,
        );
      }
      throw new ConfigError(
        `Step "${step.id}" references unknown input "${inputRef}"`,
        yamlPath,
      );
    }
    // After validating this step's inputs, add its outputs/id to the preceding sets
    precedingStepIds.add(step.id);
    if (step.output) {
      precedingOutputIds.add(step.output);
    }
  }

  enforceSchema("aos/workflow/v1", config, yamlPath, "warn");
  return config;
}

/**
 * Resolve a workflow id (a profile's `workflow:` field) to its YAML file inside
 * `workflowsDir`, trying every layout convention the repo uses. Both the flat
 * `<name>.workflow.yaml` files (the majority) and the directory convention
 * `<id>/workflow.yaml` (paperclip-worker) resolve here, so every caller —
 * `aos run`, `aos validate`, the engine, and the paperclip pass-runner — agrees
 * on where a workflow lives. Returns a path suitable for `loadWorkflow`.
 *
 * Candidates, in order:
 *   1. `<id sans -workflow>.workflow.yaml`  (e.g. cto-execution-workflow → cto-execution.workflow.yaml)
 *   2. `<id>.workflow.yaml`
 *   3. `<id>.yaml`
 *   4. `<id>/workflow.yaml`                 (directory convention, e.g. paperclip-worker)
 */
export function resolveWorkflowFile(workflowsDir: string, workflowId: string): string {
  const candidates = [
    join(workflowsDir, `${workflowId.replace(/-workflow$/, "")}.workflow.yaml`),
    join(workflowsDir, `${workflowId}.workflow.yaml`),
    join(workflowsDir, `${workflowId}.yaml`),
    join(workflowsDir, workflowId, "workflow.yaml"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new ConfigError(
    `workflow "${workflowId}" not found (tried: ${candidates.join(", ")})`,
    workflowsDir,
  );
}

export function loadSkill(skillDir: string): SkillConfig {
  const yamlPath = join(skillDir, "skill.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("skill.yaml not found", skillDir);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as SkillConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("skill.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/skill/v1") {
    throw new ConfigError(
      `Unknown schema "${config.schema}", expected "aos/skill/v1"`,
      yamlPath,
    );
  }

  const required = ["id", "name", "description", "version", "input", "output"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  validateId(config.id, yamlPath);

  // Apply defaults
  config.input.required = config.input.required || [];
  config.input.optional = config.input.optional || [];
  config.output.artifacts = config.output.artifacts || [];
  config.output.structured_result = config.output.structured_result ?? false;
  config.compatible_agents = config.compatible_agents || [];
  config.platform_bindings = config.platform_bindings || {};
  config.platform_requirements = config.platform_requirements || {};

  enforceSchema("aos/skill/v1", config, yamlPath, "warn");
  return config;
}

/**
 * Load an MCP server registry (aos/mcp/v1). NEW kind — validated strictly:
 * manual structural checks (always) + ajv against mcp.schema.json (when the
 * schema dir is resolvable). Accepts a directory containing mcp.yaml or a
 * direct path to a .yaml/.yml file.
 */
export function loadMcp(mcpPath: string): McpRegistryConfig {
  const yamlPath =
    mcpPath.endsWith(".yaml") || mcpPath.endsWith(".yml") ? mcpPath : join(mcpPath, "mcp.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("mcp.yaml not found", mcpPath);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as McpRegistryConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("mcp.yaml is empty or invalid", yamlPath);
  }

  if (config.schema !== "aos/mcp/v1") {
    throw new ConfigError(`Unknown schema "${config.schema}", expected "aos/mcp/v1"`, yamlPath);
  }

  const required = ["id", "servers"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }

  validateId(config.id, yamlPath);

  if (!Array.isArray(config.servers) || config.servers.length === 0) {
    throw new ConfigError("MCP registry must declare at least one server", yamlPath);
  }

  const seen = new Set<string>();
  for (const server of config.servers) {
    if (!server || typeof server !== "object") {
      throw new ConfigError("Each MCP server entry must be an object", yamlPath);
    }
    if (!server.id) {
      throw new ConfigError("MCP server entry missing required field: id", yamlPath);
    }
    validateId(server.id, yamlPath);
    if (seen.has(server.id)) {
      throw new ConfigError(`Duplicate MCP server id "${server.id}"`, yamlPath);
    }
    seen.add(server.id);

    if (!server.transport || !["stdio", "http", "sse"].includes(server.transport)) {
      throw new ConfigError(
        `MCP server "${server.id}" has invalid transport "${server.transport}" (stdio|http|sse)`,
        yamlPath,
      );
    }
    if (server.transport === "stdio" && !server.command) {
      throw new ConfigError(`MCP server "${server.id}" (stdio) requires "command"`, yamlPath);
    }
    if ((server.transport === "http" || server.transport === "sse") && !server.url) {
      throw new ConfigError(`MCP server "${server.id}" (${server.transport}) requires "url"`, yamlPath);
    }

    server.args = server.args ?? [];
  }

  enforceSchema("aos/mcp/v1", config, yamlPath, "strict");
  return config;
}

/**
 * Discover MCP registries in a project. Scans <projectDir>/core/mcp for:
 *   • subdirectories that contain an mcp.yaml, and
 *   • top-level *.yaml / *.yml registry files.
 * Returns [] when the directory is absent. Propagates ConfigError on a
 * malformed registry so the caller can decide whether to fail or degrade.
 */
export function discoverMcpRegistries(projectDir: string): McpRegistryConfig[] {
  const mcpRoot = join(projectDir, "core", "mcp");
  if (!existsSync(mcpRoot)) return [];

  const registries: McpRegistryConfig[] = [];
  // Sort for deterministic precedence / start order / duplicate-id attribution.
  for (const entry of readdirSync(mcpRoot).sort()) {
    const full = join(mcpRoot, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (existsSync(join(full, "mcp.yaml"))) registries.push(loadMcp(full));
    } else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
      registries.push(loadMcp(full));
    }
  }
  return registries;
}

/**
 * Load a remote agent (aos/remote-agent/v1) — a Phase 3 A2A peer. NEW kind, so
 * validated strictly (manual checks + ajv). Accepts a directory containing
 * remote-agent.yaml or a direct path to a .yaml/.yml file.
 */
export function loadRemoteAgent(remotePath: string): RemoteAgentConfig {
  const yamlPath =
    remotePath.endsWith(".yaml") || remotePath.endsWith(".yml")
      ? remotePath
      : join(remotePath, "remote-agent.yaml");

  if (!existsSync(yamlPath)) {
    throw new ConfigError("remote-agent.yaml not found", remotePath);
  }

  const raw = readFileSync(yamlPath, "utf-8");
  const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as RemoteAgentConfig;

  if (!config || typeof config !== "object") {
    throw new ConfigError("remote-agent.yaml is empty or invalid", yamlPath);
  }
  if (config.schema !== "aos/remote-agent/v1") {
    throw new ConfigError(`Unknown schema "${config.schema}", expected "aos/remote-agent/v1"`, yamlPath);
  }

  const required = ["id", "kind", "agent_card_url"] as const;
  for (const field of required) {
    if (!(field in config)) {
      throw new ConfigError(`Missing required field: ${field}`, yamlPath);
    }
  }
  validateId(config.id, yamlPath);

  if (config.kind !== "a2a") {
    throw new ConfigError(`Unsupported remote agent kind "${config.kind}" (only "a2a")`, yamlPath);
  }
  if (typeof config.agent_card_url !== "string" || config.agent_card_url.length === 0) {
    throw new ConfigError("agent_card_url must be a non-empty string", yamlPath);
  }

  config.transport = config.transport ?? "jsonrpc";
  config.cost = config.cost ?? "unmetered";

  enforceSchema("aos/remote-agent/v1", config, yamlPath, "strict");
  return config;
}

/** Discover remote agents in <projectDir>/core/remote-agents (dirs + files). */
export function discoverRemoteAgents(projectDir: string): RemoteAgentConfig[] {
  const root = join(projectDir, "core", "remote-agents");
  if (!existsSync(root)) return [];

  const out: RemoteAgentConfig[] = [];
  const seen = new Set<string>();
  const add = (cfg: RemoteAgentConfig) => {
    if (seen.has(cfg.id)) {
      throw new ConfigError(`Duplicate remote agent id "${cfg.id}"`, root);
    }
    seen.add(cfg.id);
    out.push(cfg);
  };
  for (const entry of readdirSync(root).sort()) {
    const full = join(root, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (existsSync(join(full, "remote-agent.yaml"))) add(loadRemoteAgent(full));
    } else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
      add(loadRemoteAgent(full));
    }
  }
  return out;
}

export function validateBrief(
  briefPath: string,
  requiredSections: InputSection[],
): BriefValidation {
  if (!existsSync(briefPath)) {
    throw new ConfigError("Brief file not found", briefPath);
  }

  const content = readFileSync(briefPath, "utf-8");
  const contentLower = content.toLowerCase();

  const missing = requiredSections.filter(
    (s) => !contentLower.includes(s.heading.toLowerCase()),
  );

  return { valid: missing.length === 0, content, missing };
}
