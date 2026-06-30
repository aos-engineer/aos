# Memory System

AOS provides a pluggable memory system that gives agents persistent, high-fidelity recall across sessions. The orchestrator acts as memory gatekeeper — curating writes at session end and approving recall requests mid-session.

## Providers

AOS supports multiple memory backends through the `MemoryProvider` interface:

| Provider | Backend | Recall Quality | Dependencies |
|---|---|---|---|
| **MemPalace** (recommended) | ChromaDB via MCP | Semantic search, 96.6% recall | `pip install mempalace` |
| **Graphify** | Knowledge graph via MCP (GraphRAG + Leiden + tree-sitter) | Graph-grounded answers over a built corpus | `uv tool install "graphifyy[mcp]"` |
| **Basic Expertise** (fallback) | In-memory with YAML persistence | Fuzzy matching | None |

MemPalace is the recommended provider for semantic memory. **Graphify** suits projects that want graph-grounded recall over a corpus of code + docs + notes (it builds a queryable knowledge graph and answers structural/semantic questions). The expertise fallback works without any external dependencies but provides lower recall quality. All three implement the same `MemoryProvider` interface, and the runtime falls back to expertise when a configured external provider is unavailable.

## Configuration

Memory is configured per-project in `.aos/memory.yaml`, generated automatically by `aos init`:

```yaml
api_version: aos/memory/v1

provider: mempalace           # "mempalace", "graphify", or "expertise"

mempalace:
  palace_path: ~/.mempalace/palace
  project_wing: my-project    # Wing name (one per project)
  wake_layers: [L0, L1]
  auto_hall: true
  max_wake_tokens: 1200       # Hard cap on wake context tokens
  max_drawer_tokens: 500      # Per-memory size limit

graphify:                     # used when provider: graphify
  corpus_path: .aos/graphify/corpus
  graph_path: graphify-out/graph.json
  mcp_command: graphify-mcp
  build_command: graphify
  auto_build: false           # rebuild the graph on every remember (LLM cost)
  max_wake_tokens: 1200
  max_recall_results: 8

expertise:
  max_lines: 200
  scope: per-project

orchestrator:
  remember_prompt: session_end # When orchestrator curates memories
  recall_gate: true            # Orchestrator must approve recall requests
  max_recall_per_session: 10   # Cap mid-session searches
```

## Setting Up MemPalace

```bash
# Install MemPalace
pip install mempalace

# Initialize your palace
mempalace init ~/projects/myapp

# Mine existing conversations or code
mempalace mine ~/projects/myapp

# Configure AOS to use MemPalace
# Edit .aos/memory.yaml and set provider: mempalace
```

## Setting Up Graphify

```bash
# Install graphify with the MCP extra
uv tool install "graphifyy[mcp]"

# Build a knowledge graph from your corpus (code + docs + notes)
graphify build .aos/graphify/corpus

# Configure AOS to use Graphify
# Edit .aos/memory.yaml and set provider: graphify
```

Graphify's MCP server serves an already-built graph, so build the graph before
selecting the provider (the runtime falls back to expertise until one exists).
`remember()` writes notes into `corpus_path`; set `auto_build: true` to rebuild the
graph on each write, or rebuild on a schedule with `graphify build`. Operational
agents query the graph through the `graphify-query` skill (`query_graph`,
`graph_stats`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`,
`shortest_path`).

MemPalace stores memories using a spatial metaphor:

| Concept | AOS Mapping | Purpose |
|---|---|---|
| **Wing** | Project | Isolates memory per project |
| **Room** | Agent | Per-agent knowledge within a project |
| **Hall** | Memory type | facts, events, discoveries, preferences, advice |
| **Drawer** | Individual memory | Verbatim content stored in ChromaDB |

## How Memory Works

### Session Start (Wake)

The runtime loads wake context from the active memory provider:
- **L0 (Identity):** ~100 tokens — who is this AI?
- **L1 (Essentials):** Critical facts from past sessions, capped at `max_wake_tokens`

Wake context is injected into each agent's system prompt before the session begins.

### Mid-Session (Orchestrator-Gated Recall)

Perspective agents can request memory searches using the `aos_request_recall` tool:

```
Agent: "I need to recall what we decided about auth in previous sessions"
→ aos_request_recall(query: "auth decisions", reason: "Need prior context for auth discussion")
→ Orchestrator approves or denies
→ If approved: results injected into requesting agent's context
```

The orchestrator controls all mid-session recall. This prevents noisy searches and token runaway. The `max_recall_per_session` cap provides a hard limit.

### Session End (Memory Curation)

The orchestrator receives a curation prompt and decides what to commit to long-term memory using `aos_remember`:

**Guidelines the orchestrator follows:**
- Store decisions, conclusions, and rationale — not the debate
- Store discoveries and insights valuable for future sessions
- Store verbatim — do not summarize or paraphrase
- Tag each memory with the producing agent
- Skip procedural noise (constraint checks, routing, bias tracking)

Each memory is capped at `max_drawer_tokens` (default 500) to keep recall quality high.

## Agent Access Tiers

| Agent Type | Memory Tools | Direct MemPalace Access |
|---|---|---|
| **Orchestrator** | `aos_remember`, `aos_recall` | No (uses runtime tools) |
| **Perspective agents** | `aos_request_recall` | No |
| **Operational agents** | Runtime tools | Read + Write (8 MCP tools) |
| **Auditor** | Runtime tools | Full admin (all 19 MCP tools) |

Operational agents (Operator, Steward, Auditor) can access MemPalace tools directly via the `mempalace-read-write` skill. The `mempalace-admin` skill grants full access and is restricted to the Auditor by default.

## Crash Recovery

If the MemPalace MCP server fails during a session:

1. **Health check** before session-end writes detects the failure
2. **Auto-restart** attempts one MCP server respawn
3. **JSON fallback** — if restart fails, memories are saved to `.aos/sessions/{sessionId}/memory-fallback.jsonl`
4. On next session start, fallback files are detected and can be imported

## Expertise Fallback

When MemPalace is not installed, AOS falls back to the Basic Expertise provider. This uses fuzzy matching (Levenshtein distance + token overlap) for recall — functional but significantly lower quality than MemPalace's semantic search.

The expertise fallback stores memories in-memory during sessions. For persistent storage across sessions, it uses the existing `ExpertiseManager` with structured YAML files.

### Expertise Configuration

Agents can also use the original `expertiseConfig` block for structured per-agent knowledge:

```yaml
expertiseConfig:
  enabled: true
  max_lines: 5000
  structure:
    - architecture_patterns
    - recurring_failure_modes
    - domain_heuristics
  read_on: session_start
  update_on: session_end
  scope: per-project
  mode: read-write
  auto_commit: review
```

This system runs independently of the `MemoryProvider` — it's a structured learning system that persists categorical knowledge to YAML files. The two systems complement each other: `MemoryProvider` handles free-form recall via semantic search, while `expertiseConfig` handles structured, categorized knowledge.

## Troubleshooting

**MemPalace not found at runtime**
AOS logs a warning and falls back to the expertise provider. Install MemPalace with `pip install mempalace` and run `mempalace init`.

**Wake context too large**
Reduce `max_wake_tokens` in `memory.yaml`. The provider truncates L1 by dropping lowest-relevance entries.

**Recall returning irrelevant results**
Ensure your palace is mined (`mempalace mine <dir>`). Check that `project_wing` in `memory.yaml` matches the wing name in your palace.

**Session memories not persisting**
Check the transcript for `memory_commit_failed` events. If the MCP server crashed, look for `memory-fallback.jsonl` in the session directory.

**Agent recall requests being denied**
The orchestrator gates all recall. Set `recall_gate: false` in `memory.yaml` to disable gating (not recommended for production).
