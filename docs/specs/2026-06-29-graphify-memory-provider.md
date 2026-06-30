# Graphify Memory Provider — Design

**Status:** implemented
**Date:** 2026-06-29

## Summary

Add **graphify** ([graphifylabs.ai](https://graphifylabs.ai), `graphifyy` on PyPI) as a
third pluggable memory provider alongside `expertise` (built-in) and `mempalace`.
Graphify turns a folder of code, docs, schemas, and notes into a **queryable
knowledge graph** (GraphRAG + Leiden communities + tree-sitter) and serves it over
an MCP stdio server. As an AOS memory provider it gives agents graph-grounded
recall over the project's accumulated knowledge.

## Architecture

Graphify's MCP server (`graphify-mcp <graph.json>`) is **query-only** — it serves an
already-built graph (tools: `query_graph`, `graph_stats`, `get_node`,
`get_neighbors`, …). Ingestion is a separate CLI step (`graphify build <corpus>`)
that produces the graph JSON under `graphify-out/`. The provider therefore splits
the `MemoryProvider` contract two ways:

| Method | Backed by |
|---|---|
| `recall(query)` | MCP `query_graph` → the synthesized graph answer as one `RecallEntry` |
| `wake(projectId)` | MCP `query_graph` (a wake query), bounded by `maxWakeTokens` |
| `status()` | MCP `graph_stats` → node/edge/community counts |
| `isAvailable` / `healthCheck` | MCP `tools/list` health (server up ⇒ graph loaded) |
| `remember(content)` | Write a markdown note into the corpus dir; if `autoBuild`, run `graphify build` (best-effort) |

The MCP server only starts when a built graph exists. If it isn't built yet (or
graphify isn't installed), the factory **falls back to the built-in `expertise`
provider** with a warning — identical to the mempalace fallback — so the harness is
never blocked. `remember` keeps writing to the corpus so the next `graphify build`
picks the notes up.

## Config (`.aos/memory.yaml`)

```yaml
api_version: aos/memory/v1
provider: graphify
graphify:
  corpus_path: .aos/graphify/corpus      # what graphify indexes (notes + opt. project files)
  graph_path: graphify-out/graph.json    # the built graph the MCP server serves
  mcp_command: graphify-mcp              # MCP stdio server entrypoint
  build_command: graphify                # CLI used for `graphify build`
  auto_build: true                       # rebuild the graph on remember()
  max_wake_tokens: 1200
  max_recall_results: 8
orchestrator:
  remember_prompt: session_end
  recall_gate: true
  max_recall_per_session: 10
```

Schema (`core/schema/memory.schema.json`): `provider` enum gains `"graphify"`; a
`graphify` object mirrors the fields above (snake_case on disk, camelCase in
`GraphifyConfig`).

## Factory

`createRuntimeMemoryProvider` gains a `graphify` branch: spawn an `McpClient` on
`mcp_command` with `[graph_path]`, `start()`, and on success return a
`GraphifyProvider`; on failure warn + fall back to `expertise` (or throw under
`requireConfiguredProvider`). `providerId` / `configuredProvider` unions widen to
include `"graphify"`. New options: `graphifyCommand`, `graphifyArgs`.

## CLI + skill

- `aos init` memory wizard offers `graphify` as a provider; `generateMemoryYaml`
  emits the graphify block.
- `env-scanner` probes for the `graphify` binary and reports availability.
- `core/skills/graphify-query` exposes graphify's read MCP tools to agents
  (`query_graph`, `graph_stats`, `get_node`, `get_neighbors`, `get_community`,
  `god_nodes`, `shortest_path`). Read-only — ingestion is operator/CLI driven.

## Testing

TDD with a mock `McpClient` (per `mempalace-provider.test.ts`) and an injected
build runner so tests exercise remember/recall/wake/status with no real graphify,
no graph, and no network. Factory test mirrors the mempalace start/fallback/strict
cases. `validate-config` covers the new skill + schema.
