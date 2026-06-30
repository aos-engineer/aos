# Changelog

## Unreleased

### Added

- **Graphify memory provider** — a third pluggable memory backend alongside `mempalace` and the built-in `expertise` fallback. Recall/wake/status are served by graphify's MCP server (`graphify-mcp`, `query_graph`/`graph_stats`); `remember()` writes notes into a corpus dir and (optionally) rebuilds the knowledge graph via `graphify build`. Includes the `graphify-query` skill, `aos init` wizard + env-scanner support, schema, and docs. Falls back to `expertise` when no graph is available.

## 0.9.1 — Platform stream hardening and memory observability

### Added

- Broader `test:all` release gate covering runtime, root tests, shared adapter tests, and first-party adapter runtimes.
- Arbiter memory bridge tools (`aos_recall`, `aos_remember`) and Pi adapter equivalents, wired through the runtime memory provider.
- Stable transcript `event_id` and `sequence` stamping for local JSONL and platform streaming, enabling idempotent platform ingest.
- Release-readiness checklist for local, platform, and live adapter checks.

### Changed

- Platform transcript sinks now retry failed batches during a session and avoid hanging indefinitely during shutdown.
- Platform streaming supports bearer-token auth via `AOS_PLATFORM_TOKEN` / `AOS_INGEST_TOKEN`.
- AOS branding references were normalized to `aos-harness`.
- Release versions bumped in lockstep to `0.9.1`.

### Fixed

- Bridge-server RPC now validates request shapes, returns parse errors for malformed JSON, and caps request size.
- Replay formatting now renders governance events such as `steer` and `tool-denied` without falling back to raw JSON.
- Runtime and packaging hardening around memory provider fallback, publish safety, and core-copy exclusions.

## 0.9.0 — Brief authoring, plugin parity, validate cleanup

### Added

- `aos create brief` — interactive Q&A for authoring a deliberation or execution brief, with `--non-interactive` flag-driven mode for CI/scripts. Pre-fill via `--idea "<text>"` or `--from-notes <file>` (rendered as HTML-comment seed). `--shared` writes to harness samples; `--out` overrides location; `--force` overwrites.
- `aos brief template --kind <k>` — render a kind-specific stub to stdout or `--out`.
- `aos brief validate <path>` — schema-aware linter; exit 1 on missing required sections, warning on empty bodies. `--strict` upgrades warnings to errors.
- `aos brief save <path>` — atomic write with strict validation; takes content via `--from-file <p>` (preferred) or `--from-stdin`. Used by skills.
- `cli/src/brief/` module — pure-logic types, schema, parse, validate, template, prompts, and atomic-write helpers. No LLM dependency; fully unit-testable.
- `plugins/aos-harness/skills/aos-create-brief/SKILL.md` — shared skill consumed by Claude Code, Codex, and Gemini hosts. Conducts a guided conversation in the host agent's voice, drafts polished prose, validates via `aos brief save --from-file <tempfile>`.
- `plugins/aos-harness/claude-code/commands/aos-create-brief.md` — Claude Code slash command wrapper for the skill.
- `plugins/aos-harness/.gemini/extension.json` and `gemini/install.sh` — Gemini extension packaging that was previously missing entirely. The harness now ships plugin parity across all three interactive adapter hosts.
- Run-time brief lint: `aos run` now emits a one-line summary (clean or `N errors, M warnings`) after resolving the brief, pointing at `aos brief validate` for details. Never blocks; profile-specific required-section enforcement still happens inside the runtime config-loader.
- Documentation: `docs/creating-briefs/creating-briefs-cli.md` — full guide to the new authoring flow.

### Changed

- `aos validate` no longer cross-product-checks every brief against every profile's `required_sections`. Briefs are authored per-profile, so the cross-product produced 21 nonsensical failures (e.g., asking `sample-product-decision` to satisfy `incident-response`'s `## Incident Description` requirement). The check is replaced with a single well-formedness lint per brief. Profile-specific enforcement still happens at `aos run` time.
- `plugins/aos-harness/skills/aos-create/SKILL.md` cross-references `aos-create-brief` for users wanting to author briefs (vs. scaffold templates).
- `plugins/aos-harness/.codex-plugin/plugin.json` `defaultPrompt` now mentions brief authoring.
- `cli/package.json` peer-dependency floor for adapters bumped to `>=0.9.0` to express the intended pairing.
- README adds a brief-authoring quick-start.
- Release versions bumped in lockstep to `0.9.0`.

### Fixed

- `aos validate`: 91 passed, 21 failed → 91 passed, 0 failed.

## 0.8.5 — Long-running deliberation timeout fix

### Changed

- Strategic Council now allows long-running arbiter and agent turns by raising the profile timeout to 3600 seconds.
- Release versions are bumped in lockstep to `0.8.5`.

### Fixed

- Adapter runtime message calls now honor profile-level `agent_timeout_seconds` instead of always aborting at 120 seconds.
- Claude Code Strategic Council runs can continue past the previous 120-second arbiter cutoff when launched through the updated local/runtime path.

## 0.8.4 — Release hardening and adapter preflight

### Added

- Preflight adapter-readiness checks in `aos run` for non-Pi adapters before session startup.
- Claude Code live auth probe when `ANTHROPIC_API_KEY` is forcing external API-key auth, so invalid keys fail fast before arbiter startup.
- npm release propagation guard in CI via `scripts/wait-for-npm-release.ts`.

### Changed

- `aos run` now warns about adapter/CLI version drift before launching non-Pi sessions.
- Session startup output now streams arbiter partial text when available and emits a waiting heartbeat during silent vendor CLI periods.
- Site deployment metadata and release versioning are bumped in lockstep to `0.8.4`.

### Fixed

- Non-zero adapter subprocess exits are now surfaced as failed arbiter calls even when the vendor CLI emitted text before exiting.
- Claude Code runs no longer appear to hang silently when auth is broken; invalid external API keys are reported up front.
- Release verification no longer fails spuriously when npm package propagation lags after publish.

## 0.8.3 — Adapter defaults, current CLI compatibility, and docs hardening

### Added

- Adapter-scoped runtime model configuration in `.aos/config.yaml` under `adapter_defaults`.
- Automatic backfill of `adapter_defaults` for existing v2 configs during `aos run`.
- `use_vendor_default_model` support for adapters and legacy `.aos/adapter.yaml`.
- Claude readiness scanning via `claude auth status --json`, with explicit hints when `ANTHROPIC_API_KEY` is forcing Claude Code into API-key mode.

### Changed

- Runtime model selection now prefers adapter-scoped config, then legacy adapter config, then env vars, then adapter defaults.
- Default behavior is now adapter-aware:
  - `pi` keeps explicit tier models by default
  - `codex`, `claude-code`, and `gemini` use the vendor CLI default model unless explicitly pinned
- Codex adapter updated to the current CLI contract:
  - `codex exec`
  - `codex exec resume`
  - current JSON event parsing
- Claude Code adapter updated to:
  - `--output-format stream-json`
  - inline context instead of removed `--add-file`
- Gemini adapter updated to current headless flags:
  - `--prompt`
  - `--output-format stream-json`
  - `--resume`
- Recommended model families refreshed across adapters and docs.
- Public docs, package READMEs, and Astro pages now describe adapter-scoped model behavior, vendor-default model selection, and current auth troubleshooting paths.
- Site deployment metadata and release versioning are bumped in lockstep to `0.8.3`.

### Fixed

- `aos run --adapter codex ...` no longer fails on the removed `--system-prompt` flag.
- Claude Code readiness no longer relies on `claude config list`, which could surface unrelated invalid-key failures during scanning.
- Existing configs without `adapter_defaults` now migrate forward without requiring a manual re-run of `aos init`.

## 0.8.2 — Local install docs and release alignment

### Added

- Getting-started docs now show both global and project-local install flows for `aos-harness`, including:
  - `bun add aos-harness`
  - `npm install aos-harness`
  - `bunx aos ...`
  - `npx aos ...`
- The Astro homepage and getting-started page now surface the package-install flow directly instead of implying global install only.

### Changed

- Release versions are bumped in lockstep to `0.8.2` across the CLI, runtime, and adapter packages.
- Site deployment metadata now points at the `0.8.2` site image tag.

## 0.8.1 — Adapter Resolution And MemPalace Detection Fixes

### Fixed

- `aos init` and `aos run` now resolve globally installed adapter packages consistently instead of reporting them as installed-but-broken when the current `aos` install could not import them by package name.
- The init scanner now falls back to explicit global package directory discovery for `@aos-harness/*-adapter` packages.
- MemPalace readiness messaging now distinguishes between:
  - binary installed on `PATH`
  - socket detected and available
- When the `mempalace` binary is present but the default socket is missing, the scanner now reports the binary path and suggests setting `MEMPALACE_SOCKET` for custom socket locations.

## 0.8.0 — Environment-aware init wizard

### Added

- `aos init` now scans two separate readiness signals per adapter family:
  - vendor CLI readiness (`claude`, `codex`, `gemini`, `pi`)
  - AOS adapter-package readiness (`@aos-harness/<name>-adapter`)
- Interactive init wizard backed by `@clack/prompts`.
- Non-interactive scan/report mode:
  - `aos init --non-interactive` writes `.aos/scan.json` and exits without config writes when no adapter selection is present.
  - `aos init --non-interactive --adapter <name>` validates the selected adapter and exits `3` if it is not ready.
- `aos init --apply` installs missing adapter packages after config generation.
- New v2 `.aos/config.yaml` shape:
  ```yaml
  api_version: aos/config/v2
  adapters:
    enabled: [pi, codex]
    default: codex
  package_manager: bun
  ```

### Changed

- `aos run` and `aos init` now share the same adapter precedence:
  1. `--adapter`
  2. `.aos/config.yaml` v2 `adapters.default`
  3. legacy `.aos/config.yaml` `adapter`
  4. `.aos/adapter.yaml` `platform`
  5. fallback `pi`
- Config migration during init now preserves comments via `yaml.parseDocument`.
- Docs and Astro site getting-started flows now describe vendor-CLI-first setup and the new init behavior.

### Migration

- Re-run `aos init` in existing projects to migrate `.aos/config.yaml` from v1 (`adapter: pi`) to v2 (`adapters.enabled/default`).
- `.aos/adapter.yaml` remains supported for adapter-specific overrides such as `model_overrides`.

## 0.7.1 — CLI polish

### Fixed

- `aos --version` / `aos --v` / `aos -v` now print the real installed version (read from `package.json` at runtime). Previously the CLI hardcoded `v0.1.0` — stale since 0.2.0.
- Pi adapter branding corrected across the CLI. Install hints and error messages now point at [pi.dev](https://pi.dev) (source: [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)) instead of the unrelated `pi-ai` / nonexistent `pi-agi/pi`.

### Internal

- New `getCliVersion()` helper in `cli/src/utils.ts` — shared between the `--version` flag handler and the no-command banner. Works in both monorepo dev and npm-installed contexts.

## 0.7.0 — Adapter Trust Model (security)

### Breaking

- **Adapter source inside a cloned repo is no longer loaded.** The CLI resolves adapters only from installed `@aos-harness/<name>-adapter` packages or the monorepo dev layout (from the CLI's own install location). A project-local `adapters/<name>/` directory is ignored. Adapter authors should use `npm link @aos-harness/my-adapter`.
- **`executeCode` is denied by default.** Profiles that use code execution must add:
  ```yaml
  tools:
    execute_code:
      enabled: true
      languages: [python, bash]
      max_timeout_ms: 60000
  ```
- **Unknown adapter names exit 2.** The CLI now allowlists `pi`, `claude-code`, `codex`, `gemini`.
- **New exit code 3:** profile tool-policy validation failures and CLI flag attempting to widen profile.

### Added

- `--allow-code-execution[=<langs>|none]` flag to narrow (never widen) the profile's code-execution allowlist for a single session.
- Tool-denied events appended to `transcript.jsonl` for audit.
- `BaseWorkflow.listEnabledTools()` read-only API.
- `validatePlatformUrl` rejects non-https (except loopback), link-local, and metadata addresses.

### Migration

See `docs/security/profile-tools-migration.md` (new).

### Release infrastructure

- Packages are now published from GitHub Actions via an environment-gated release workflow. Consumers can verify the registry's built-in signature with `npm audit signatures` after install. Trust is anchored on the tag-triggered, reviewer-approved CI publish path.
- Local `publish:all` is replaced by `publish:dry-run` (pack-only, no upload). Publishing from a laptop is no longer supported; use `git tag -a v<version>` + push.
- YAML-safety lint is now AST-based (`scripts/check-yaml-safety.ts`). The previous grep-based version is removed.
- `scripts/copy-core.ts` refuses symlink targets and paths outside `cli/core`.
- CI workflow gained a minimum `permissions: { contents: read }` block.

## [0.6.0] - 2026-04-14

### Breaking

- **`aos-harness` no longer bundles adapter code.** You must install the adapter(s) you use as separate packages. If you run `aos run` without the matching `@aos-harness/<name>-adapter` installed, the CLI now exits with code `2` and prints both the global and project-local install commands. The bundled fallback path that 0.5.x used has been removed, along with the deprecation warning that 0.5.2 printed when it was hit.
- **CLI tarball no longer ships `adapters/`.** The `files` field in `cli/package.json` is now `["src/", "core/", "README.md"]`.

### Added

- Adapters declared as optional peer dependencies on the CLI, range `">=0.6.0 <1.0.0"`. `peerDependenciesMeta.*.optional = true` so `npm i -g aos-harness` continues to succeed with no peers installed.
- Runtime version-mismatch warning when the CLI's major or minor version differs from the loaded adapter's. Patch-level drift is silent. Fires once per package per session.
- `aos init` prints the adapter install commands at the end (Claude Code, Gemini, Codex, Pi — all four).
- `aos init --adapter` now accepts `codex` in addition to `pi`, `claude-code`, `gemini`.

### Migration

1. Upgrade the CLI: `npm i -g aos-harness@0.6.0`
2. Install the adapter(s) you were relying on:
   ```bash
   npm i -g @aos-harness/claude-code-adapter@0.6.0
   npm i -g @aos-harness/gemini-adapter@0.6.0
   npm i -g @aos-harness/codex-adapter@0.6.0
   npm i -g @aos-harness/pi-adapter@0.6.0
   ```
3. Re-run `aos run`. No other changes required.

## [0.5.2] - 2026-04-14

### Deprecated

- **Bundled adapters will be removed in 0.6.0.** When `aos run` falls back to the bundled copy of an adapter (i.e., the standalone `@aos-harness/<name>-adapter` package is not installed), the CLI now prints a one-time yellow deprecation warning per project with the install command needed to prepare for 0.6.0. The flag file `.aos/migration-warned-0.6` records that the warning was shown; delete it to re-enable. The warning is also deduped within a single process so multi-adapter runs don't double-warn.

### Unchanged

- Bundled adapter loading still works exactly as before. 0.5.2 is purely additive — no runtime behavior changes beyond the warning.

## [0.5.1] - 2026-04-14

### Fixed

- `aos-harness` CLI tarball dropped from ~39 MB to ~220 KB. `scripts/copy-core.ts` now filters out `node_modules/`, lockfiles, `.aos/` session data, and test directories when bundling adapters into the CLI. Users installing the CLI no longer pull ~15k transitive files from bundled adapters' dev dependencies.

## [0.5.0] - 2026-04-13

### Added

- Standalone npm distribution for all four adapters: `@aos-harness/claude-code-adapter`, `@aos-harness/codex-adapter`, `@aos-harness/gemini-adapter`, `@aos-harness/pi-adapter`. Hybrid model — adapters are still bundled inside the `aos-harness` CLI for zero-install UX.
- `[adapter]` log line at adapter load time showing package name, version, and whether the adapter was resolved standalone or from the CLI's bundled copy.

### Changed

- Lockstep versioning across the seven published packages. `scripts/publish.ts` now enforces a single `releaseVersion` across `runtime`, `adapter-shared`, the four adapters, and the CLI.
- `scripts/publish.ts` refactored to a single loop with a `publishWithPinnedDeps` helper. Idempotent: re-running after a partial publish skips packages already on the registry.
- Every adapter `package.json` now declares `description`, `license`, `repository.directory`, `homepage`, `keywords`, `engines.bun`, `files`, and `publishConfig.access`.

## [0.1.0] - 2026-03-24

### Added

**Core Framework**
- 13 agent personas with distinct cognitive biases (Arbiter, CTO Orchestrator, Catalyst, Sentinel, Architect, Provocateur, Navigator, Advocate, Pathfinder, Strategist, Operator, Steward, Auditor)
- 6 orchestration profiles (strategic-council, cto-execution, security-review, delivery-ops, architecture-review, incident-response)
- 5 domain knowledge packs (SaaS, healthcare, fintech, platform-engineering, personal-decisions)
- 7 workflow definitions (brainstorm, plan, execute, review, debug, verify, cto-execution)
- JSON Schema validation for all config types (agent, profile, domain, workflow, artifact, skill)

**Execution Profiles**
- Delegation pattern: CTO orchestrator drives 8-step workflow with 3 review gates
- Artifact system: inter-step work product passing with manifest tracking, revision management
- 4 workflow action types: targeted-delegation, tension-pair, orchestrator-synthesis, execute-with-tools
- DelegationDelegate interface: workflow runner calls real engine delegation
- Execution package output renderer with YAML frontmatter
- Agent capabilities declarations (can_execute_code, can_produce_files, available_skills)
- `role_override` for shifting agents from advisory to production mode
- `retry_with_feedback` gate behavior with feedback injection loop

**Skill Awareness (Layer 3)**
- `aos/skill/v1` schema for skill manifests
- 3 example skill definitions: code-review, security-scan, task-decomposition
- `loadSkill()` in config-loader with schema validation

**Runtime Engine**
- Constraint engine (time, budget, rounds with conflict resolution)
- Delegation router (broadcast, targeted, tension-pair with bias enforcement)
- Template resolver with optional variable line stripping
- Domain merger (append-only overlay semantics)
- Workflow runner with transcript event emission (10 event types)
- Budget estimation with auth-mode awareness

**Platform Adapters**
- Pi CLI adapter: full 4-layer implementation (agent runtime, event bus, UI, workflow engine)
- Pi adapter execution methods: executeCode (sandboxed subprocess), invokeSkill (skill manifest loading), createArtifact, loadArtifact, submitForReview
- Claude Code adapter: static artifact generator with execution profile awareness

**CLI**
- `aos init` — initialize project
- `aos run [profile]` — run deliberation or execution sessions
- `aos create agent|profile|domain|skill` — scaffold configs
- `aos validate` — validate all configs including skills and cross-references
- `aos list` — list agents, profiles, domains, skills with type indicators
- `aos replay` — replay session transcripts
- `--verbose`, `--dry-run`, `--domain`, `--brief`, `--workflow-dir` flags

**Security**
- Safe YAML deserialization (JSON_SCHEMA on all yaml.load calls)
- Artifact ID validation (path traversal prevention)
- Editor allowlist for openInEditor
- Sandbox enforcement for code execution (strict/relaxed modes)
- Prompt/code separation in execute-with-tools
- CI lint rule for unsafe yaml.load detection
- Subprocess environment allowlisting

**Testing**
- 194 tests across 12 test files, 504 assertions
- Unit tests for all runtime modules
- Integration tests for CTO execution profile
- End-to-end workflow test with mock delegation
- Security regression tests

**Documentation**
- Framework design specification
- Execution profiles spec suite (4 documents)
- Getting started guide
- Creating agents, profiles, domains guides
- Sample briefs for strategic-council and cto-execution

**CI/CD**
- GitHub Actions workflow: test, typecheck, YAML safety lint, config validation
