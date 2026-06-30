// runtime/src/memory-provider.ts

// ── Health Status ──────────────────────────────────────────────

export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

// ── Wake Context ───────────────────────────────────────────────

export interface WakeContext {
  identity: string;
  essentials: string;
  tokenEstimate: number;
  truncated: boolean;
}

// ── Recall Types ───────────────────────────────────────────────

export interface RecallOpts {
  projectId: string;
  agentId?: string;
  hall?: string;
  maxResults?: number;
}

export interface RecallEntry {
  content: string;
  wing: string;
  room: string;
  hall: string;
  similarity: number;
  source?: string;
}

export interface RecallResult {
  entries: RecallEntry[];
  tokenEstimate: number;
}

// ── Remember Types ─────────────────────────────────────────────

export interface RememberOpts {
  projectId: string;
  agentId: string;
  hall?: string;
  source?: string;
  sessionId?: string;
}

export type RememberId = string;

// ── Configuration ──────────────────────────────────────────────

export interface MempalaceConfig {
  palacePath: string;
  projectWing: string;
  wakeLayers: ("L0" | "L1")[];
  autoHall: boolean;
  maxWakeTokens: number;
  maxDrawerTokens: number;
}

export interface GraphifyConfig {
  /** Directory graphify indexes into a knowledge graph (notes + opt. project files). */
  corpusPath: string;
  /** The built graph JSON the MCP server serves. */
  graphPath: string;
  /** MCP stdio server entrypoint (default "graphify-mcp"). */
  mcpCommand: string;
  /** CLI used for `graphify build` (default "graphify"). */
  buildCommand: string;
  /** Rebuild the graph from the corpus on remember(). */
  autoBuild: boolean;
  /** Token budget for wake context. */
  maxWakeTokens: number;
  /** Max entries returned by recall. */
  maxRecallResults: number;
}

/**
 * Memory-specific expertise config (camelCase convention).
 * Separate from ExpertiseConfig in types.ts which uses snake_case
 * for direct YAML mapping and includes fields not relevant to memory.
 */
export interface ExpertiseMemoryConfig {
  maxLines: number;
  scope: "per-project" | "global";
}

export interface OrchestratorMemoryConfig {
  rememberPrompt: "session_end" | "per_round";
  recallGate: boolean;
  maxRecallPerSession: number;
}

export interface MemoryConfig {
  provider: "mempalace" | "expertise" | "graphify";
  mempalace?: MempalaceConfig;
  graphify?: GraphifyConfig;
  expertise?: ExpertiseMemoryConfig;
  orchestrator: OrchestratorMemoryConfig;
}

// ── Status ─────────────────────────────────────────────────────

export interface MemoryStatus {
  provider: string;
  available: boolean;
  drawerCount?: number;
  wings?: string[];
  rooms?: Record<string, string[]>;
}

// ── Provider Interface ─────────────────────────────────────────

export interface MemoryProvider {
  readonly id: string;
  readonly name: string;

  initialize(config: MemoryConfig): Promise<void>;
  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<HealthStatus>;

  wake(projectId: string, agentId?: string): Promise<WakeContext>;
  recall(query: string, opts: RecallOpts): Promise<RecallResult>;
  remember(content: string, opts: RememberOpts): Promise<RememberId>;

  status(): Promise<MemoryStatus>;
}
