# AOS Harness — Comprehensive Feature Documentation

**Agentic Orchestration System (AOS)**
*A Language-Agnostic Multi-Agent Orchestration Framework for Strategic Deliberation and Execution*

**Version:** 0.9.1
**Date:** April 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Core Philosophy and Design Principles](#2-core-philosophy-and-design-principles)
3. [Dual Orchestration Paradigm](#3-dual-orchestration-paradigm)
4. [Agent System](#4-agent-system)
5. [Cognitive Architecture and Bias Engineering](#5-cognitive-architecture-and-bias-engineering)
6. [Tension Pair Dynamics](#6-tension-pair-dynamics)
7. [Orchestration Profiles](#7-orchestration-profiles)
8. [Constraint Engine](#8-constraint-engine)
9. [Delegation and Routing System](#9-delegation-and-routing-system)
10. [Workflow Engine](#10-workflow-engine)
11. [Artifact Management System](#11-artifact-management-system)
12. [Domain Knowledge Packs](#12-domain-knowledge-packs)
13. [Skill System](#13-skill-system)
14. [4-Layer Adapter Contract](#14-4-layer-adapter-contract)
15. [Transcript and Observability System](#15-transcript-and-observability-system)
16. [Template Resolution Engine](#16-template-resolution-engine)
17. [Output Rendering System](#17-output-rendering-system)
18. [Configuration System](#18-configuration-system)
19. [CLI Toolchain](#19-cli-toolchain)
20. [Security Architecture](#20-security-architecture)
21. [Error Handling and Resilience](#21-error-handling-and-resilience)
22. [Budget Estimation and Cost Control](#22-budget-estimation-and-cost-control)
23. [Expertise and Institutional Memory](#23-expertise-and-institutional-memory)
24. [Platform Adapters](#24-platform-adapters)
25. [Testing and Quality Assurance](#25-testing-and-quality-assurance)
26. [Extensibility Model](#26-extensibility-model)

---

## 1. Executive Summary

The Agentic Orchestration System (AOS) Harness is a language-agnostic, config-first orchestration system that assembles specialized AI agents into teams capable of two distinct operational modes: **strategic deliberation** (multi-perspective debate producing ranked recommendations) and **artifact-driven execution** (structured workflows producing implementation-ready deliverables).

The harness addresses a fundamental limitation in current AI tooling: single-agent systems lack the cognitive diversity required for robust decision-making and complex multi-phase execution. AOS solves this by modeling a team of 15 AI agents — each with engineered cognitive biases, distinct reasoning frameworks, and defined interpersonal tensions — orchestrated under configurable time, budget, and round constraints.

### Key Differentiators

- **Engineered Cognitive Diversity:** Each agent has a distinct bias, risk tolerance, time horizon, and evidence standard — producing genuine multi-perspective analysis rather than superficial variation.
- **Structured Disagreement:** Tension pairs and speaks-last structural advantages ensure critical perspectives are not drowned out by early consensus.
- **Constraint-Governed Sessions:** Time, budget, and round constraints with conflict detection ensure sessions terminate predictably while meeting quality minimums.
- **Artifact-Driven Workflows:** Execution profiles produce versioned, reviewable work products that chain between steps, enabling complex multi-phase deliverables.
- **Platform Agnosticism:** A 4-layer adapter contract decouples the orchestration logic from any specific AI runtime, enabling deployment across Pi CLI, Claude Code, Gemini, and future platforms.

### Harness at a Glance

| Dimension | Value |
|-----------|-------|
| Agent Personas | 15 (2 orchestrators, 9 perspectives, 4 operational) |
| Orchestration Profiles | 8 (strategic-council, cto-execution, security-review, delivery-ops, architecture-review, incident-response, dev-execution, design-variations) |
| Domain Packs | 5 (SaaS, healthcare, fintech, platform-engineering, personal-decisions) |
| Workflow Definitions | 9 (brainstorm, plan, execute, review, debug, verify, cto-execution, dev-execution, design-variations) |
| Skills | 6 (code-review, security-scan, task-decomposition, mempalace-read-write, mempalace-admin, graphify-query) |
| Runtime Size | ~2,000 lines TypeScript |
| Test Coverage | 70+ test files, including 400+ passing runtime tests |

---

## 2. Core Philosophy and Design Principles

### 2.1 Config-First, Code-Second

AOS follows a hybrid architecture where the majority of system behavior is expressed declaratively through YAML configuration and Markdown prompts, with a minimal TypeScript runtime handling only what configuration cannot express:

- **Configuration Layer (YAML + Markdown):** Agent personas, orchestration profiles, domain overlays, workflow definitions, skill manifests, and input/output specifications. This is what makes the harness language-agnostic.
- **Minimal Runtime (~2,000 lines TypeScript):** Constraint evaluation, delegation routing, template resolution, artifact management, bias enforcement, and error recovery. Small enough to port to other languages.
- **Platform Adapters:** Thin implementations that wire config + runtime to specific execution environments.

This design enables non-programmers to customize agent behavior, create new profiles, and define domain knowledge packs without writing code.

### 2.2 Three-Tier User Model

The harness serves three tiers of sophistication:

| Tier | User | Action | Outcome |
|------|------|--------|---------|
| **Tier 1: Install & Run** | New agentic engineers | Install a profile, submit a brief | Get a structured output; learn by using |
| **Tier 2: Customize & Build** | Intermediate engineers | Create agents, profiles, domain packs | Build orchestration tailored to their industry |
| **Tier 3: Full Platform** | Advanced / enterprise | Web dashboard, observability, team management | Production-grade orchestration with analytics |

### 2.3 Separation of Concerns

The harness enforces clean boundaries between:

- **What agents think** (persona YAML + prompt Markdown)
- **How sessions run** (profile YAML + constraint engine)
- **What domain applies** (domain YAML with append-only overlays)
- **What workflow to execute** (workflow YAML with step definitions)
- **Where it runs** (platform adapter implementations)

This separation enables independent evolution of each layer without cascading changes.

---

## 3. Dual Orchestration Paradigm

AOS supports two fundamentally different orchestration patterns through a unified engine:

### 3.1 Deliberation Mode

**Purpose:** Strategic decision-making through structured multi-perspective debate.

**Flow:**
```
Brief → Arbiter frames question → Opening broadcast (all agents)
→ Targeted rounds (selective delegation) → Tension pair debates
→ Provocateur stress-test (speaks last) → Arbiter synthesis → Memo output
```

**Characteristics:**
- The Arbiter orchestrator maintains neutrality, frames questions, and synthesizes without imposing its own position.
- All perspectives are heard in opening rounds before targeted delegation begins.
- Tension pairs enable structured disagreement between agents with opposing biases.
- The Provocateur always speaks last with full visibility of prior arguments, providing a structural check against premature consensus.
- Output is a structured memo with ranked recommendations, agent stances, documented dissent, trade-offs, and next actions.

**Use Cases:** Strategic decisions (acquisition, pricing, market entry), architecture reviews, security assessments, incident retrospectives.

### 3.2 Execution Mode

**Purpose:** Structured production of implementation-ready deliverables through artifact-driven workflows.

**Flow:**
```
Brief → Requirements analysis (Advocate + Strategist) → Architecture design (Architect)
→ Architecture review (Architect vs. Operator tension pair) → Phase planning (Strategist + Operator)
→ Task breakdown (Operator) → Security review (Sentinel) → Stress test (Provocateur)
→ Final assembly (CTO Orchestrator) → Execution package output
```

**Characteristics:**
- A CTO/CIO/CEO orchestrator drives a multi-step workflow with defined review gates.
- Each step produces a versioned artifact that can be consumed by subsequent steps.
- Review gates (user-approval or automated-review) provide quality checkpoints.
- Agents shift from advisory mode to production mode via `role_override`.
- Output is a structured execution package with YAML frontmatter, including requirements, architecture, task breakdown, risk assessment, and implementation checklist.

**Use Cases:** Feature development, product launch planning, migration execution, incident response playbooks.

### 3.3 Paradigm Comparison

| Dimension | Deliberation | Execution |
|-----------|-------------|-----------|
| Orchestrator | Arbiter (neutral facilitator) | CTO/CIO/CEO (execution leader) |
| Agent Mode | Advisory (perspectives on a question) | Production (producing deliverables) |
| Output | Structured memo with recommendations | Execution package with artifacts |
| Flow | Debate rounds with targeted follow-up | Sequential workflow with gates |
| Quality Control | Speaks-last structural advantage | Review gates with retry loops |
| Inter-step Data | N/A | Artifact chaining via manifests |

---

## 4. Agent System

### 4.1 Agent Definition Schema (`aos/agent/v1`)

Every agent is defined as a YAML metadata file paired with a Markdown system prompt. The schema captures the agent's cognitive architecture, persona, relationship tensions, output format, tool access, skill capabilities, expertise files, and model configuration.

```yaml
schema: aos/agent/v1
id: unique-identifier          # kebab-case identifier
name: Human-Readable Name
role: Brief role description

cognition:
  objective_function: "What this agent optimizes for"
  time_horizon:
    primary: "Primary time frame"
    secondary: "Secondary time frame"
    peripheral: "Background awareness"
  core_bias: keyword
  risk_tolerance: very-low | low | moderate | high | very-high
  default_stance: "Default position"

persona:
  temperament: []              # Behavioral traits
  thinking_patterns: []        # Reasoning questions
  heuristics: [{name, rule}]   # Decision rules
  evidence_standard:
    convinced_by: []
    not_convinced_by: []
  red_lines: []                # Non-negotiable boundaries

tensions: [{agent, dynamic}]   # Productive disagreements
report:
  structure: "Output format instructions"

tools: null | []               # null = platform defaults, [] = no tools
skills: []                     # Skill references
expertise:
  - path: relative/path.md
    mode: read-only | read-write
    use_when: "Trigger condition"

model:
  tier: economy | standard | premium
  thinking: off | on | extended

capabilities:                  # Execution profile capabilities
  can_execute_code: bool
  can_produce_files: bool
  can_review_artifacts: bool
  available_skills: []
  output_types: [text, markdown, code, diagram, structured-data]
```

### 4.2 Agent Roster

The harness ships with 15 agents across three categories:

#### Orchestrators (2 agents)

| Agent | Role | Behavior |
|-------|------|----------|
| **Arbiter** | Decision integrator for deliberation | Frames questions, drives debate, synthesizes ranked recommendations. Maintains strict neutrality — weighs perspectives without imposing position. |
| **CTO Orchestrator** | Execution leader for workflows | Drives production workflows, manages step transitions, assembles final execution packages. Focused on execution quality and completeness. |

#### Perspective Agents (9 agents)

| Agent | Core Bias | Risk Tolerance | Time Horizon | Default Stance |
|-------|-----------|----------------|--------------|----------------|
| **Catalyst** | Speed & monetization | High | 0–6 months | "Ship it, learn, iterate" |
| **Sentinel** | Protection & sustainability | Very low | 2–5 years | "Protect the asset" |
| **Architect** | System durability | Low | 1–3 years | "Make it buildable and maintainable" |
| **Provocateur** | Truth-seeking | High | All horizons | "What are we not seeing?" |
| **Navigator** | Market positioning | Moderate | 6–18 months | "Timing and positioning matter" |
| **Advocate** | User behavior reality | Moderate | 0–12 months | "What do users actually do?" |
| **Pathfinder** | Asymmetric upside | Very high | 1–5 years | "What's the 10x opportunity?" |
| **Strategist** | Impact per effort | Moderate | 6–24 months | "Sequence for maximum leverage" |
| **Artifact Renderer** | Output fidelity | Moderate | Immediate | "Ship a complete artifact bundle" |

#### Operational Agents (4 agents)

| Agent | Core Bias | Focus Area |
|-------|-----------|------------|
| **Operator** | Execution reality | Team capacity, dependencies, delivery risk |
| **Steward** | Compliance | Ethics, legal, regulatory, governance |
| **Auditor** | Institutional learning | Retrospective analysis, pattern recognition |
| **Engineering Lead** | Execution quality | Worker delegation, implementation coordination, test verification |

### 4.3 Agent Cognitive Architecture

Each agent is defined with a multi-dimensional cognitive profile:

- **Objective Function:** What the agent optimizes for (e.g., "Minimize time-to-revenue" for Catalyst).
- **Time Horizon:** Three-tier temporal awareness (primary, secondary, peripheral) that shapes how the agent weights near-term vs. long-term considerations.
- **Core Bias:** The deliberate cognitive bias that differentiates this agent's perspective (e.g., speed, sustainability, truth-seeking).
- **Risk Tolerance:** Five-level scale that influences how the agent evaluates uncertain outcomes.
- **Default Stance:** The agent's starting position before evidence is presented.
- **Thinking Patterns:** Specific questions the agent asks itself when reasoning (e.g., Sentinel asks "What's the worst that could happen if this goes wrong?").
- **Heuristics:** Named decision rules that guide the agent's reasoning (e.g., Architect's "Three-System Rule: if it touches three systems, it needs a design doc").
- **Evidence Standard:** What convinces and does not convince the agent (e.g., Sentinel is convinced by "historical failure data" but not by "optimistic projections").
- **Red Lines:** Absolute boundaries the agent will not cross regardless of other pressures.

### 4.4 System Prompts

Each agent has a companion `prompt.md` file that provides the full system prompt with `{{VARIABLE}}` placeholders resolved at runtime. This separation of metadata (YAML) from behavioral instructions (Markdown) enables:

- Schema validation of agent configuration without parsing natural language
- Template variable injection at session startup
- Independent versioning of cognitive profile vs. behavioral instructions

---

## 5. Cognitive Architecture and Bias Engineering

### 5.1 Engineered Cognitive Diversity

Unlike systems that create "different perspectives" through simple prompt variation, AOS engineers genuine cognitive diversity through structured differentiation across multiple dimensions:

**Dimension 1 — Objective Function Divergence:**
Each agent optimizes for a fundamentally different outcome. Catalyst optimizes for time-to-revenue; Sentinel optimizes for long-term trust preservation; Architect optimizes for system durability. These are not superficial label changes — they produce structurally different recommendations from the same input.

**Dimension 2 — Temporal Perspective Spread:**
Agents operate on different time horizons. Catalyst's primary horizon is 0–6 months; Sentinel's primary horizon is 2–5 years. When evaluating the same decision, this temporal spread ensures both near-term execution and long-term consequences are surfaced.

**Dimension 3 — Risk Tolerance Spectrum:**
The five-level risk tolerance scale (very-low to very-high) creates natural disagreement about uncertain outcomes. Sentinel (very-low) and Pathfinder (very-high) will reliably produce opposing assessments of the same risk, ensuring the decision-maker sees the full spectrum.

**Dimension 4 — Evidence Standard Asymmetry:**
Agents require different types of evidence to change their position. Catalyst is convinced by "revenue data and time-to-market analysis" but not by "theoretical risk without historical precedent." Sentinel is convinced by "historical failure data" but not by "optimistic projections." This asymmetry prevents superficial agreement.

### 5.2 Structural Advantage: Speaks-Last

The Provocateur agent has a code-enforced structural advantage: in broadcast rounds, it always speaks last. This ensures:

- The stress-testing perspective has full visibility of all prior arguments before responding.
- Early consensus cannot suppress critical challenges.
- The Provocateur's input is maximally informed, producing higher-quality challenges.

This is implemented at the engine level, not the prompt level — the delegation router ensures the Provocateur is always sequenced last in broadcast rounds, regardless of how other agents are ordered.

---

## 6. Tension Pair Dynamics

### 6.1 Designed Tensions

AOS models productive interpersonal tensions as first-class configuration objects. Each tension pair represents a structural disagreement that generates useful analytical output:

| Tension Pair | Dynamic | Analytical Value |
|---|---|---|
| **Catalyst ↔ Sentinel** | "Ship now" vs. "Protect long-term value" | Surfaces speed/quality trade-offs |
| **Architect ↔ Pathfinder** | "What's feasible" vs. "What's 10x" | Balances pragmatism with ambition |
| **Advocate ↔ Navigator** | "User needs now" vs. "Market timing" | Grounds positioning in user reality |
| **Catalyst ↔ Pathfinder** | "Proven revenue" vs. "Speculative bets" | Calibrates risk appetite |
| **Strategist ↔ Operator** | "Ideal sequence" vs. "Execution reality" | Tests plans against capacity |
| **Provocateur ↔ All** | Stress-tests every position | Prevents unchallenged assumptions |

### 6.2 Tension Pair Delegation

The orchestrator can delegate specifically to a tension pair, triggering a structured two-agent debate on a focused question. This is implemented as a distinct delegation type (`tension-pair`) in the delegation router, producing richer analysis than either agent could produce alone.

In execution workflows, tension pairs are used for critical review steps. For example, the CTO Execution workflow uses an Architect ↔ Operator tension pair for architecture review, ensuring designs are challenged against execution reality before proceeding.

---

## 7. Orchestration Profiles

### 7.1 Profile Schema (`aos/profile/v1`)

Profiles define the complete configuration for an orchestration session:

- **Assembly:** Which orchestrator and which perspective/operational agents participate, with optional structural advantages.
- **Delegation:** Default routing strategy, opening round behavior, tension pair definitions, and bias limits.
- **Constraints:** Time (min/max minutes), budget (min/max currency), and rounds (min/max).
- **Input:** Format requirements (brief, question, document, freeform) with required sections and context files.
- **Output:** Format (memo, execution-package), path template, sections, artifacts, and frontmatter fields.
- **Error Handling:** Agent timeouts, retry policies, failure escalation, and partial result handling.
- **Budget Estimation:** Rolling average or fixed estimate strategies with safety margins.
- **Controls:** User control options (halt, wrap/early-end, interject).
- **Workflow:** Optional workflow reference for execution profiles.
- **Expertise:** Institutional memory configuration (per-agent, shared, or none).

### 7.2 Shipped Profiles

#### strategic-council (Deliberation)
- **Assembly:** Arbiter orchestrator + 11 perspective/operational agents
- **Delegation:** Broadcast default, 1 opening round, 5 tension pairs, bias limit of 5
- **Constraints:** 2–10 minutes, $1–$10, 2–8 rounds
- **Output:** Structured memo with ranked recommendations, agent stances, dissent, trade-offs, next actions

#### cto-execution (Execution)
- **Assembly:** CTO Orchestrator + Advocate, Strategist, Architect, Operator, Sentinel, Provocateur
- **Delegation:** Targeted default, tension pairs for architecture review
- **Workflow:** 8 steps, 3 review gates
- **Output:** Execution package with requirements, architecture, phase plan, tasks, risk assessment, stress test

#### security-review (Deliberation)
- **Assembly:** Security-focused agent subset (Architect, Sentinel, Steward, Provocateur, Operator)
- **Focus:** Security assessment and remediation planning

#### delivery-ops (Execution)
- **Assembly:** Delivery-focused subset (Strategist, Operator, Architect, Catalyst)
- **Focus:** Product delivery orchestration

#### architecture-review (Deliberation)
- **Focus:** Technical architecture evaluation and decision-making

#### incident-response (Deliberation)
- **Focus:** Incident analysis, root cause identification, remediation planning

---

## 8. Constraint Engine

### 8.1 Three-Dimensional Constraints

The constraint engine evaluates session state against three orthogonal constraint dimensions:

| Dimension | Min (Floor) | Max (Ceiling) | Measurement |
|-----------|-------------|---------------|-------------|
| **Time** | Minimum minutes of deliberation | Maximum minutes allowed | Wall-clock elapsed time |
| **Budget** | Minimum spend before session can end | Maximum spend before hard stop | Token-based cost estimation |
| **Rounds** | Minimum delegation rounds | Maximum delegation rounds | Agent dispatch count |

### 8.2 Constraint Evaluation Logic

**Priority Order:** `budget_max > time_max > rounds_max` (hard ceilings), then soft floors.

**State Tracking (15+ fields):**

```
Minimums:     past_min_time, past_min_budget, past_min_rounds, past_all_minimums
Approaching:  approaching_max_time, approaching_max_budget, approaching_max_rounds (80%+)
Hard Stops:   hit_maximum, hit_reason (none | time | budget | rounds | constraint_conflict)
Bias:         bias_ratio, most_addressed, least_addressed, bias_blocked
```

**Session Termination Rules:**
- A session can end normally only when `past_all_minimums` is true.
- A session is force-terminated when any maximum is hit (`hit_maximum = true`).
- If a maximum is hit before minimums are met (< 50% progress), a `constraint_conflict` is flagged.

### 8.3 Conflict Detection

The constraint engine detects structural conflicts between constraints. For example, if a budget maximum is hit after only 1 of 3 required minimum rounds, the engine flags this as a `constraint_conflict` — indicating the profile's constraints are misconfigured (budget is too tight for the minimum rounds required).

This prevents silent quality degradation where sessions end prematurely without meeting their own quality standards.

### 8.4 Auth-Mode Awareness

The constraint engine adapts its behavior based on the authentication mode:

- **Metered (API key):** Full budget tracking with token-based cost estimation.
- **Unmetered (subscription):** Budget constraints are skipped; only time and round constraints apply.

This prevents subscription-mode users from being blocked by irrelevant budget constraints.

---

## 9. Delegation and Routing System

### 9.1 Delegation Types

The delegation router supports three routing strategies:

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| **Broadcast** | All assembled agents respond | Opening rounds, full-perspective gathering |
| **Targeted** | Specific agents respond | Follow-up on specific perspectives |
| **Tension Pair** | Two agents debate | Structured disagreement on focused question |

### 9.2 Broadcast Execution

Broadcast delegation uses a hybrid parallel + sequential strategy:

1. All agents **except** those with `speaks-last` structural advantage are dispatched in parallel.
2. `speaks-last` agents (e.g., Provocateur) are dispatched sequentially after all parallel responses complete.

This ensures the Provocateur sees all prior responses while maximizing throughput for non-privileged agents.

### 9.3 Bias Enforcement

The bias system prevents the orchestrator from over-relying on a subset of agents:

- **Bias Ratio:** Calculated as `max_calls / min_calls` across all assembled agents.
- **Bias Limit:** Configurable ceiling (e.g., 5 means the most-addressed agent cannot be called more than 5x the least-addressed agent).
- **Bias Blocking:** When the bias limit is reached, the router blocks targeted delegation to the over-addressed agent, forcing the orchestrator to distribute attention.
- **Opening Rounds:** The first N rounds (configurable via `opening_rounds`) force broadcast delegation, ensuring all agents are heard at least once before targeted delegation begins.

### 9.4 Call Count Tracking

The router maintains per-agent call counts and provides real-time bias state to the orchestrator:

```json
{
  "bias_ratio": 3.0,
  "most_addressed": "architect",
  "least_addressed": "steward",
  "bias_blocked": false
}
```

This transparency enables the orchestrator to make informed delegation decisions while the hard limit prevents systematic perspective exclusion.

---

## 10. Workflow Engine

### 10.1 Workflow Schema (`aos/workflow/v1`)

Workflows define multi-step processes with inter-step data flow and quality gates:

```yaml
schema: aos/workflow/v1
id: workflow-id
name: Workflow Name

steps:
  - id: step-id
    name: Step Name
    action: targeted-delegation | tension-pair | orchestrator-synthesis | execute-with-tools
    agents: [agent-ids]
    prompt: "Template with {{variables}}"
    code: "Optional code for execute-with-tools"
    input: [previous_step_output_ids]
    output: artifact-id
    review_gate: bool
    structural_advantage: speaks-last

gates:
  - after: step-id
    type: user-approval | automated-review
    prompt: "Decision prompt"
    max_iterations: N
    on_rejection: re-run-step | retry_with_feedback
```

### 10.2 Workflow Action Types

| Action | Behavior | Agents |
|--------|----------|--------|
| **targeted-delegation** | Specific agents produce work in parallel | 1+ agents |
| **tension-pair** | Two agents debate a question | Exactly 2 agents |
| **orchestrator-synthesis** | Orchestrator assembles from prior artifacts | Orchestrator only |
| **execute-with-tools** | Run code or tool operations | Agent with code execution |

### 10.3 Step Execution Flow

1. **Input Resolution:** Load artifacts from prior steps referenced in `input[]`.
2. **Template Resolution:** Substitute `{{variables}}` in prompts, including artifact content.
3. **Action Dispatch:** Execute the step's action type with the designated agents.
4. **Artifact Creation:** If `output` is defined, create a versioned artifact from the step's output.
5. **Gate Check:** If `review_gate` is true, pause for approval before proceeding.
6. **Transcript Emission:** Emit `step_start` and `step_end` events for observability.

### 10.4 Review Gates

Gates provide quality checkpoints within workflows:

- **user-approval:** The workflow pauses and prompts the human user for approval. On rejection, the step is re-run with feedback.
- **automated-review:** An automated review agent evaluates the output. On failure, the step retries with feedback up to `max_iterations`.
- **retry_with_feedback:** On rejection, the previous agent's output and the reviewer's feedback are injected into the next attempt, enabling iterative improvement.

### 10.5 CTO Execution Workflow (8 Steps, 3 Gates)

| Step | Name | Action | Agents | Output Artifact |
|------|------|--------|--------|-----------------|
| 1 | Requirements Analysis | targeted-delegation | Advocate, Strategist | `requirements_analysis` |
| 2 | Architecture & Design | targeted-delegation | Architect | `architecture_decision_record` |
| — | **Gate: Architecture Approval** | user-approval | — | — |
| 3 | Architecture Review | tension-pair | Architect, Operator | `revised_architecture` |
| 4 | Phase Planning | targeted-delegation | Strategist, Operator | `phase_plan` |
| — | **Gate: Phase Plan Approval** | user-approval | — | — |
| 5 | Task Breakdown | targeted-delegation | Operator | `task_breakdown` |
| 6 | Security & Risk Review | targeted-delegation | Sentinel | `risk_assessment` |
| 7 | Final Stress Test | targeted-delegation | Provocateur (speaks-last) | `stress_test_findings` |
| 8 | Execution Package Assembly | orchestrator-synthesis | CTO Orchestrator | `execution_package` |

---

## 11. Artifact Management System

### 11.1 Artifact Manifest Schema (`aos/artifact/v1`)

Every work product produced by a workflow step is tracked via a manifest:

```json
{
  "schema": "aos/artifact/v1",
  "id": "architecture-decision-record",
  "produced_by": ["architect"],
  "step_id": "design",
  "format": "markdown",
  "content_path": ".aos/artifacts/architecture-decision-record.md",
  "metadata": {
    "produced_at": "2026-03-24T10:30:00Z",
    "review_status": "approved",
    "review_gate": "architecture-approval",
    "word_count": 1240,
    "revision": 2
  }
}
```

### 11.2 Artifact Lifecycle

1. **Creation:** `createArtifact(id, content, format, producedBy, stepId)` — Creates the artifact file and manifest.
2. **Loading:** `loadArtifact(id)` — Reads the artifact and manifest for injection into subsequent steps.
3. **Revision:** `reviseArtifact(id, content)` — Updates content, increments revision counter, resets review status to `pending`.
4. **Review:** `updateReviewStatus(id, status, gate)` — Sets review status to `approved`, `rejected`, or `revised`.
5. **Injection:** `formatForInjection(artifact)` — Formats the artifact with metadata header for inclusion in agent prompts.

### 11.3 Artifact ID Validation

Artifact IDs must match the pattern `^[a-z][a-z0-9_-]*$` (lowercase alphanumeric with hyphens and underscores). This prevents path traversal attacks and ensures filesystem-safe naming.

### 11.4 Inter-Step Data Flow

Artifacts enable data flow between workflow steps. A step's `input` field references output IDs from prior steps. At execution time, the workflow runner:

1. Loads the referenced artifacts via manifest lookup.
2. Formats them with metadata headers (author, step, revision, review status).
3. Injects the formatted content into the current step's prompt via template variables.

This creates a traceable chain of provenance — every artifact knows which agents produced it, which step created it, and its current review status.

---

## 12. Domain Knowledge Packs

### 12.1 Domain Schema (`aos/domain/v1`)

Domains are optional industry-specific context packs that augment agent behavior without modifying base agent definitions:

```yaml
schema: aos/domain/v1
id: saas
name: SaaS Business

lexicon:
  metrics: [ARR, MRR, NRR, CAC, LTV, logo_churn, revenue_churn]
  frameworks: [product_led_growth, enterprise_sales, land_and_expand]
  stages: [pre_seed, seed, series_a, series_b, growth, scale]

overlays:
  catalyst:
    thinking_patterns: ["What's the fastest path to the next MRR milestone?"]
    heuristics:
      - name: Revenue Velocity
        rule: "Prioritize features with direct ARR impact"
  sentinel:
    red_lines: ["Never recommend features that increase churn risk above 5%"]

additional_input_sections:
  - heading: "## SaaS Metrics"
    guidance: "Include current ARR, MRR, churn rates"

additional_output_sections:
  - section: saas_metrics_impact
    description: "Projected impact on SaaS unit economics"

guardrails:
  - "All recommendations must reference impact on CAC:LTV ratio"
```

### 12.2 Append-Only Overlay Semantics

Domain overlays use strict append-only merge semantics — they can only ADD to agent configurations, never remove or override. This prevents domains from accidentally neutralizing core agent traits:

| Field | Merge Behavior |
|-------|----------------|
| `thinking_patterns` | Appended to agent's existing patterns |
| `heuristics` | Appended (no deduplication) |
| `red_lines` | Appended (union with agent's red lines) |
| `evidence_standard.convinced_by` | Appended |
| `evidence_standard.not_convinced_by` | Appended |
| `temperament` | Appended |
| Tensions | NOT merged (profile-level only) |

### 12.3 Shipped Domain Packs

| Domain | Focus | Key Metrics/Concepts |
|--------|-------|---------------------|
| **SaaS** | Software-as-a-Service business | ARR, MRR, NRR, CAC, LTV, churn |
| **Healthcare** | Clinical and health systems | HIPAA, HL7, patient outcomes, clinical workflows |
| **Fintech** | Financial technology | Regulatory compliance, risk modeling, payment systems |
| **Platform Engineering** | Developer platforms and infrastructure | SLOs, platform adoption, developer experience |
| **Personal Decisions** | Individual life and career decisions | Personal values, risk appetite, life-stage context |

---

## 13. Skill System

### 13.1 Skill Schema (`aos/skill/v1`)

Skills are reusable capabilities that agents can invoke during workflow execution:

```yaml
schema: aos/skill/v1
id: code-review
name: Code Review
version: "1.0.0"

input:
  required:
    - id: code_artifact
      type: artifact
      description: "The code to review"
  optional:
    - id: standards
      type: text
      description: "Coding standards to apply"

output:
  artifacts:
    - id: review_report
      format: markdown
      description: "Detailed review findings"
  structured_result: false

compatible_agents: [sentinel, architect, operator]

platform_bindings:
  claude-code: "superpowers:requesting-code-review"
  pi: null

platform_requirements:
  requires_code_execution: false
  requires_file_access: true
  requires_network: false
  min_context_tokens: 8000
```

### 13.2 Skill Capabilities

| Skill | Input | Output | Compatible Agents |
|-------|-------|--------|-------------------|
| **code-review** | Code artifact + optional standards | Review report (markdown) | Sentinel, Architect, Operator |
| **security-scan** | Code/architecture artifacts | Security findings (markdown) | Sentinel, Steward |
| **task-decomposition** | Phase plan + architecture | Task breakdown (structured-data) | Operator, Strategist |

### 13.3 Platform Bindings

Skills can bind to platform-specific implementations:
- **Pi CLI:** Direct invocation through workflow adapter
- **Claude Code:** Maps to superpowers skills (e.g., `superpowers:requesting-code-review`)
- **Gemini:** API-based invocation

### 13.4 Agent Capability Declarations

Agents declare their capabilities in the `capabilities` block, enabling the workflow engine to match skills to agents:

```yaml
capabilities:
  can_execute_code: true
  can_produce_files: true
  can_review_artifacts: true
  available_skills: [code-review, task-decomposition]
  output_types: [text, markdown, code, structured-data]
```

---

## 14. 4-Layer Adapter Contract

### 14.1 Architecture

The adapter contract defines four layers of platform integration, enabling AOS to run on any AI runtime:

```
┌─────────────────────────────────────────────┐
│                 AOS Engine                   │
│  (config loader, constraint engine,          │
│   delegation router, workflow runner)        │
├──────────┬──────────┬──────────┬────────────┤
│  L1:     │  L2:     │  L3:     │  L4:       │
│  Agent   │  Event   │  User    │  Workflow  │
│  Runtime │  Bus     │  Interface│  Engine   │
├──────────┴──────────┴──────────┴────────────┤
│            Platform Adapter                  │
│  (Pi CLI, Claude Code, Gemini, custom...)    │
└─────────────────────────────────────────────┘
```

### 14.2 Layer 1: Agent Runtime

Core agent lifecycle management:

| Method | Purpose |
|--------|---------|
| `spawnAgent(config, sessionId)` | Create an agent subprocess/session |
| `sendMessage(handle, message, opts)` | Send message with optional context, abort signal, streaming |
| `destroyAgent(handle)` | Tear down an agent |
| `setOrchestratorPrompt(prompt)` | Inject/modify orchestrator system prompt |
| `injectContext(handle, files)` | Load context files into agent |
| `getContextUsage(handle)` | Token tracking |
| `setModel(handle, modelConfig)` | Set model for agent |
| `abort()` | Hard stop all agents |

### 14.3 Layer 2: Event Bus

Lifecycle hooks and interception:

| Method | Purpose |
|--------|---------|
| `onSessionStart(handler)` | Initialization hook |
| `onSessionShutdown(handler)` | Cleanup hook |
| `onBeforeAgentStart(handler)` | Pre-agent hook (system prompt injection) |
| `onAgentEnd(handler)` | Post-agent hook |
| `onToolCall(handler)` | Intercept/block tool calls |
| `onToolResult(handler)` | Post-tool hook |
| `onMessageEnd(handler)` | Cost and token tracking |
| `onCompaction(handler)` | Custom context compaction logic |

### 14.4 Layer 3: User Interface

Rendering and interaction:

| Method | Purpose |
|--------|---------|
| `registerCommand(name, handler)` | Register slash commands |
| `registerTool(name, schema, handler)` | Register custom tools |
| `renderAgentResponse(agent, response, color)` | Display agent output |
| `renderCustomMessage(type, content, details)` | Custom message rendering |
| `setWidget(id, renderer)` | Live-updating UI widgets |
| `setFooter(renderer)` | Persistent footer |
| `setStatus(key, text)` | Status bar updates |
| `promptSelect/promptConfirm/promptInput` | User interaction prompts |
| `blockInput/unblockInput` | Input control during execution |
| `steerMessage(message)` | Inject agent-attributed messages |

### 14.5 Layer 4: Workflow Engine

Process orchestration:

| Method | Purpose |
|--------|---------|
| `dispatchParallel(agents, message, opts)` | Concurrent multi-agent dispatch |
| `executeCode(code, opts)` | Sandboxed code execution |
| `invokeSkill(skillId, input)` | Skill invocation |
| `createArtifact/loadArtifact` | Artifact management |
| `submitForReview(artifactId, reviewers)` | Review submission |
| `isolateWorkspace()` | Git worktree creation |
| `writeFile/readFile` | File system operations |
| `persistState/loadState` | State persistence |

### 14.6 Platform Coverage Matrix

| Capability | Pi CLI | Claude Code | Gemini CLI |
|---|---|---|---|
| L1: Agent spawn | Native subprocess | Agent tool | API call |
| L1: System prompt | `before_agent_start` | CLAUDE.md + agents/ | GEMINI.md |
| L2: Event hooks | Full (20+ events) | Partial (hooks) | Minimal |
| L2: Tool interception | `tool_call` event | Hooks only | Not supported |
| L3: TUI widgets | Full (widgets, footer) | Terminal text only | Terminal text only |
| L3: Commands | `registerCommand()` | Slash commands | Extensions |
| L4: Parallel dispatch | `Promise.allSettled` | Multiple Agent calls | Concurrent API |
| L4: Git worktrees | Bash + git | `isolation: "worktree"` | Bash + git |

---

## 15. Transcript and Observability System

### 15.1 Transcript Format

Every session produces a `.jsonl` transcript — one JSON event per line — providing a complete record of session activity:

```jsonl
{"type":"session_start","session_id":"a1b2c3","timestamp":"...","profile":"strategic-council",...}
{"type":"delegation","from":"arbiter","to":"all","round":1,...}
{"type":"response","from":"catalyst","tokens_in":1200,"tokens_out":800,"cost":0.42,...}
{"type":"constraint_check","state":{"elapsed_minutes":3.2,"budget_spent":4.10,...}}
{"type":"session_end","elapsed_minutes":8.4,"total_cost":6.72,"end_reason":"deliberation_complete"}
```

### 15.2 Event Types (20 types)

| Category | Events |
|----------|--------|
| **Session** | `session_start`, `session_end`, `agent_spawn`, `agent_destroy` |
| **Delegation** | `delegation` (round info, parallel/sequential agents) |
| **Response** | `response` (agent output, cost, token counts, status) |
| **Constraints** | `constraint_check`, `constraint_warning`, `budget_estimate`, `budget_abort` |
| **Control** | `steer` (operator override), `error` |
| **Expertise** | `expertise_write` |
| **Workflow** | `workflow_start`, `step_start`, `step_end`, `gate_prompt`, `gate_result`, `artifact_write`, `workflow_end` |
| **Execution** | `code_execution`, `skill_invocation`, `review_submission` |
| **Synthesis** | `final_statement` |

### 15.3 Replay Capability

Transcripts can be replayed via `aos replay <transcript.jsonl>`, enabling:

- Post-session analysis and debugging
- Training material for agentic orchestration engineers
- Quality auditing of agent behavior
- Cost analysis and optimization

---

## 16. Template Resolution Engine

### 16.1 Variable Substitution

The template resolver supports `{{variable_name}}` syntax with the following behaviors:

- **Standard Variables:** `{{session_id}}`, `{{date}}`, `{{profile_name}}` — replaced with runtime values.
- **Hyphenated Names:** `{{profile-name}}` — supports kebab-case variable names.
- **Optional Variables:** Variables like `{{role_override}}` strip the entire containing line if the variable resolves to an empty string, preventing blank lines in output.
- **Unknown Variables:** Left as-is (not errored), enabling forward compatibility.

### 16.2 Artifact Injection

When artifacts are injected into step prompts, the template resolver formats them with metadata headers:

```markdown
---
Artifact: architecture-decision-record
Produced by: architect
Step: design
Revision: 2
Review Status: approved
---

[Artifact content here]
```

---

## 17. Output Rendering System

### 17.1 Memo Output (Deliberation)

Deliberation sessions produce structured memos with YAML frontmatter:

```markdown
---
date: 2026-03-24
session_id: a1b2c3
duration_minutes: 8.4
budget_used: 6.72
currency: USD
profile: strategic-council
domain: saas
participants: [arbiter, catalyst, sentinel, ...]
brief_path: briefs/brief.md
transcript_path: sessions/transcript.jsonl
---

# Strategic Council Memo: [Brief Title]

## Recommendation (Ranked)
### 1. [Primary Recommendation] (RECOMMENDED)
### 2. [Alternative]
### 3. [Not Recommended] (NOT RECOMMENDED)

## Agent Stances
| Agent | Position | Core Reasoning | Key Concern |

## Dissent & Unresolved Tensions
## Trade-offs & Risks
## Next Actions
## Deliberation Summary
```

### 17.2 Execution Package Output (Execution)

Execution profiles produce structured packages with YAML frontmatter:

```markdown
---
date: 2026-03-24
session_id: a1b2c3
duration_minutes: 45.2
profile: cto-execution
workflow: cto-execution
phases_completed: [understand, design, challenge, plan, tasks, security-review, stress-test, synthesize]
gates_passed: [architecture-approval, phase-plan-approval]
---

# Execution Package: [Session ID]

## Executive Summary
## 1. Requirements
## 2. Architecture Decision Record
## 3. Phase Plan
## 4. Task Breakdown
## 5. Risk Assessment
## 6. Stress Test Findings
## 7. Implementation Checklist
```

---

## 18. Configuration System

### 18.1 Schema Validation

All configuration files are validated against versioned schemas:

| Schema | Purpose |
|--------|---------|
| `aos/agent/v1` | Agent persona and cognitive configuration |
| `aos/profile/v1` | Orchestration session configuration |
| `aos/domain/v1` | Industry knowledge pack |
| `aos/workflow/v1` | Multi-step process definition |
| `aos/artifact/v1` | Work product manifest |
| `aos/skill/v1` | Reusable agent capability |

### 18.2 Cross-Reference Validation

The `aos validate` command performs cross-reference validation:

- Profile references to agents exist in the agents directory
- Workflow step agent references match profile assembly
- Gate `after` references match actual step IDs
- Output IDs are unique across all workflow steps
- Skill compatibility matches agent capabilities

### 18.3 Safe YAML Parsing

All `yaml.load()` calls use `JSON_SCHEMA` (the safest parsing mode), preventing arbitrary code execution via configuration files. A CI lint rule detects any unsafe yaml.load patterns.

---

## 19. CLI Toolchain

### 19.1 Commands

| Command | Description |
|---------|-------------|
| `aos init` | Initialize AOS in the current project directory, scan vendor CLI readiness, and write project config |
| `aos run [profile]` | Run a deliberation or execution session |
| `aos create agent\|profile\|domain\|skill <name>` | Scaffold new configuration files |
| `aos validate` | Validate all configuration files with cross-references |
| `aos list` | List all agents, profiles, domains, skills with type indicators |
| `aos replay <transcript.jsonl>` | Replay a recorded session transcript |

### 19.2 Run Command Options

| Flag | Description |
|------|-------------|
| `--domain <domain>` | Apply a domain knowledge pack |
| `--brief <file>` | Path to the input brief |
| `--verbose` | Enable verbose output |
| `--dry-run` | Validate configuration without executing |
| `--workflow-dir <dir>` | Custom workflow definition directory |

### 19.3 Scaffolding

The `aos create` command generates well-structured templates:

- **Agent:** YAML metadata file + prompt.md system prompt
- **Profile:** Complete profile YAML with defaults
- **Domain:** Domain overlay YAML with lexicon and overlay stubs
- **Skill:** Skill manifest YAML with input/output definitions

---

## 20. Security Architecture

### 20.1 Input Safety

| Threat | Mitigation |
|--------|------------|
| **YAML deserialization attacks** | All `yaml.load()` uses `JSON_SCHEMA` (safe mode). CI lint rule enforces. |
| **Path traversal via artifact IDs** | Artifact IDs validated against `^[a-z][a-z0-9_-]*$` pattern. |
| **Directory traversal via file paths** | Pi adapter validates all file paths stay within project directory. |
| **Prompt injection via code** | `execute-with-tools` separates `prompt` and `code` fields — code cannot modify prompts. |

### 20.2 Process Isolation

| Mechanism | Implementation |
|-----------|---------------|
| **Subprocess environment** | Allowlist of safe environment variables (PATH, HOME, etc.). Prevents information leakage. |
| **Code execution sandboxing** | Two modes: `strict` (restricted) and `relaxed` (full access). Configurable per-step. |
| **Agent timeout** | Per-agent response timeout (configurable via `agent_timeout_seconds`). Prevents runaway agents. |
| **Editor allowlist** | Only approved editors can be launched via `openInEditor`. |

### 20.3 Cost Safety

| Mechanism | Implementation |
|-----------|---------------|
| **Budget maximums** | Hard ceiling on session spend. Highest priority constraint. |
| **Budget estimation** | Rolling average or fixed estimate with configurable safety margin. |
| **Auth-mode detection** | Metered vs. unmetered detection prevents unnecessary budget enforcement. |

---

## 21. Error Handling and Resilience

### 21.1 Agent Failure Modes

| Failure | Response Options |
|---------|-----------------|
| Agent timeout | `skip` (continue without), `abort_round` (skip current round), `abort_session` (hard stop) |
| Orchestrator failure | `save_transcript_and_exit` (preserve all data) |
| Partial results | `include_with_status_flag` (include marked as incomplete) |

### 21.2 Retry Policies

```yaml
retry_policy:
  max_retries: 2
  backoff: exponential | linear
```

Failed agent dispatches are retried with configurable backoff. Retries are tracked in the transcript for post-session analysis.

### 21.3 Gate Rejection Handling

When a review gate rejects an artifact:

- **re-run-step:** The entire step is re-executed from scratch.
- **retry_with_feedback:** The original output and rejection feedback are injected into a new attempt, enabling iterative improvement.

---

## 22. Budget Estimation and Cost Control

### 22.1 Estimation Strategies

| Strategy | Behavior |
|----------|----------|
| **rolling_average** | Uses the rolling average of actual token counts from completed rounds to estimate future costs. |
| **fixed_estimate** | Uses a fixed token estimate (e.g., 2000 tokens) for each round. |

### 22.2 Safety Margin

A configurable safety margin (default 15%) is applied to estimates to prevent budget overruns:

```
estimated_cost = estimate * (1 + safety_margin)
```

### 22.3 Budget Exceeded Actions

| Action | Behavior |
|--------|----------|
| `drop_optional` | Drop optional (non-required) agents from future rounds |
| `warn_arbiter` | Alert the orchestrator about budget pressure |
| `block_round` | Prevent the next round from starting |

---

## 23. Expertise and Institutional Memory

### 23.1 Per-Agent Expertise Files

Agents can maintain persistent scratch pads across sessions:

```yaml
expertise:
  - path: expertise/architect-notes.md
    mode: read-write
    use_when: "When reviewing prior architecture decisions"
```

### 23.2 Expertise Modes

| Mode | Behavior |
|------|----------|
| **per-agent** | Each agent has their own expertise file |
| **shared** | All agents share a common expertise file |
| **none** | No expertise tracking |

### 23.3 Access Modes

| Mode | Behavior |
|------|----------|
| **read-only** | Agent can reference but not modify |
| **read-write** | Agent can update their notes for future sessions |

---

## 24. Platform Adapters

### 24.1 Pi CLI Adapter (Primary — Full Implementation)

The Pi CLI adapter is the primary reference implementation, providing full coverage of all 4 layers:

**L1 — Agent Runtime:**
- Subprocess spawning via Pi CLI (`pi --mode json`)
- Session files per agent (`.aos/sessions/{sessionId}/{agentId}.jsonl`)
- Model tier resolution (economy/standard/premium mapping to actual model IDs)
- Context file injection via `@file` syntax
- JSON event stream parsing for token usage tracking
- Cost calculation from token counts
- Environment allowlisting for secure subprocess execution

**L2 — Event Bus:**
- Full lifecycle hook support (20+ event types)
- Pre-agent-start system prompt injection
- Tool call and result interception
- Compaction triggers
- Session shutdown handlers

**L3 — User Interface:**
- Color-coded agent response rendering (unique color per agent)
- Constraint gauge rendering (color-coded progress bars for time/budget/rounds)
- Custom message types for constraints, budget warnings, gate prompts
- Slash command registration (`/aos-run`, `/aos-pause`, etc.)
- Status bar updates (current round, elapsed time, budget spent)
- Blocking input during workflow execution
- Theme support (synthwave default)

**L4 — Workflow Engine:**
- `Promise.allSettled` for concurrent agent dispatch
- Git worktree creation for workspace isolation
- Sandboxed code execution (strict/relaxed modes)
- Skill manifest loading and invocation
- Artifact creation, loading, and review submission
- State persistence (key-value store)
- Path validation (directory traversal prevention)

### 24.2 Claude Code Adapter

Claude Code integration with stream-json parsing, session resume support, and the AOS MCP bridge exposing `delegate` and `end` tools to the arbiter.

### 24.3 Codex Adapter

Codex CLI integration with JSON event parsing, resume support, and MCP server configuration for the same `delegate` and `end` arbiter tools.

### 24.4 Gemini Adapter

Google Gemini CLI integration with headless prompt execution, session resume support, and project-local MCP settings for the AOS arbiter bridge.

### 24.5 Custom Adapters

The 4-layer adapter contract enables third-party implementations. Any platform that can:
1. Spawn agent sessions (L1)
2. Hook into lifecycle events (L2)
3. Render output and collect input (L3)
4. Execute workflows and manage files (L4)

...can serve as an AOS platform.

---

## 25. Testing and Quality Assurance

### 25.1 Test Suite

| Test File | Scope | Focus |
|-----------|-------|-------|
| `constraint-engine.test.ts` | Unit | Time, budget, rounds evaluation; conflict detection |
| `delegation-router.test.ts` | Unit | Broadcast, targeted, tension routing; bias enforcement |
| `config-loader.test.ts` | Unit | YAML parsing, schema validation, error handling |
| `domain-merger.test.ts` | Unit | Append-only overlay merging |
| `artifact-manager.test.ts` | Unit | Artifact lifecycle, manifest, revision, review status |
| `template-resolver.test.ts` | Unit | Variable substitution, optional line stripping |
| `engine.test.ts` | Unit | Session lifecycle, agent spawning, delegation flow |
| `workflow-runner.test.ts` | Unit | Step execution, input/output chaining, gate pausing |
| `output-renderer.test.ts` | Unit | Execution package markdown rendering |
| `types.test.ts` | Unit | Type assertions |
| `execution-profile.integration.test.ts` | Integration | Full CTO execution workflow |
| `workflow-e2e.test.ts` | E2E | End-to-end workflow with mock delegation |

### 25.2 Coverage

- **70+ test files** across runtime, CLI, adapter, and script surfaces
- **400+ runtime tests** covering happy paths, edge cases, and error conditions
- **Security regression tests** for YAML safety, path traversal, and input validation

### 25.3 CI/CD Pipeline

GitHub Actions workflow:
1. Run all tests
2. TypeScript type checking
3. YAML safety lint (detects unsafe `yaml.load` patterns)
4. Configuration validation (cross-reference checks)

---

## 26. Extensibility Model

### 26.1 Adding Agents

Create a new agent by:
1. Defining the cognitive architecture in `agent.yaml` (schema: `aos/agent/v1`)
2. Writing the system prompt in `prompt.md`
3. Referencing the agent in one or more profile assemblies

No code changes required.

### 26.2 Adding Profiles

Create a new orchestration profile by:
1. Defining the assembly, delegation, constraints, and output format in `profile.yaml` (schema: `aos/profile/v1`)
2. Optionally creating a workflow definition for execution profiles

No code changes required.

### 26.3 Adding Domains

Create a new domain pack by:
1. Defining the lexicon, overlays, and guardrails in `domain.yaml` (schema: `aos/domain/v1`)
2. Agent overlays are automatically applied via append-only merge semantics

No code changes required.

### 26.4 Adding Skills

Create a new skill by:
1. Defining inputs, outputs, compatible agents, and platform bindings in `skill.yaml` (schema: `aos/skill/v1`)
2. Implementing platform bindings in the relevant adapters

Minimal code changes (platform binding only).

### 26.5 Adding Platform Adapters

Create a new platform adapter by:
1. Implementing the 4-layer adapter interface (`AgentRuntimeAdapter`, `EventBusAdapter`, `UIAdapter`, `WorkflowAdapter`)
2. Registering the adapter with the AOS engine

The runtime engine and all configuration remain unchanged.

---

## Appendix A: Schema Reference

| Schema | Version | File Pattern |
|--------|---------|-------------|
| `aos/agent/v1` | 1.0 | `core/agents/*/agent.yaml` |
| `aos/profile/v1` | 1.0 | `core/profiles/*/profile.yaml` |
| `aos/domain/v1` | 1.0 | `core/domains/*/domain.yaml` |
| `aos/workflow/v1` | 1.0 | `core/workflows/*.yaml` |
| `aos/artifact/v1` | 1.0 | `.aos/artifacts/*-manifest.json` |
| `aos/skill/v1` | 1.0 | `core/skills/*/skill.yaml` |

## Appendix B: Directory Structure

```
aos-harness/
  core/                    # Language-agnostic configuration
    agents/                # 13 agent personas
      arbiter/             # Orchestrator (deliberation)
      cto-orchestrator/    # Orchestrator (execution)
      catalyst/            # Speed & monetization bias
      sentinel/            # Protection & sustainability bias
      architect/           # Systems design & feasibility bias
      provocateur/         # Stress-testing, speaks-last
      navigator/           # Market positioning bias
      advocate/            # User voice bias
      pathfinder/          # 10x thinking bias
      strategist/          # Impact-per-effort bias
      operator/            # Execution reality bias
      steward/             # Compliance bias
      auditor/             # Institutional learning bias
    profiles/              # 6 orchestration profiles
    domains/               # 5 domain knowledge packs
    skills/                # 6 skill definitions
    workflows/             # 7 workflow definitions
    schema/                # JSON Schema validation
    briefs/                # Sample input briefs
  runtime/                 # Minimal TypeScript engine (~2,000 lines)
    src/
      engine.ts            # Session orchestration
      types.ts             # Type system
      constraint-engine.ts # Time/budget/rounds evaluation
      delegation-router.ts # Agent dispatch routing
      workflow-runner.ts   # Step execution
      artifact-manager.ts  # Work product lifecycle
      domain-merger.ts     # Append-only overlay merging
      config-loader.ts     # YAML configuration loading
      output-renderer.ts   # Output document generation
      template-resolver.ts # Variable substitution
    tests/                 # Runtime unit and integration tests
  adapters/                # Platform-specific implementations
    pi/                    # Pi CLI adapter (full 4-layer)
    claude-code/           # Claude Code adapter
    codex/                 # Codex CLI adapter
    gemini/                # Gemini CLI adapter
  cli/                     # CLI toolchain
    src/
      index.ts             # Command dispatcher
      commands/            # init, run, create, validate, list, replay
  docs/                    # Documentation
    specs/                 # Design specifications
    getting-started/       # Getting started guide
    creating-agents/       # Agent creation guide
    creating-profiles/     # Profile creation guide
```

## Appendix C: Glossary

| Term | Definition |
|------|-----------|
| **Agent** | An AI persona with a defined cognitive bias, evidence standard, and reasoning framework |
| **Arbiter** | The neutral orchestrator for deliberation sessions |
| **Artifact** | A versioned work product produced by a workflow step |
| **Assembly** | The set of agents participating in a session |
| **Bias Limit** | The maximum ratio of most-addressed to least-addressed agent |
| **Brief** | A structured Markdown input document with required sections |
| **Broadcast** | Delegation to all assembled agents |
| **Constraint** | A time, budget, or round limit on session execution |
| **Deliberation** | An orchestration pattern focused on multi-perspective debate |
| **Domain** | An industry-specific knowledge pack applied as overlays |
| **Execution** | An orchestration pattern focused on artifact-driven workflows |
| **Gate** | A quality checkpoint within a workflow (user-approval or automated-review) |
| **Memo** | The structured output of a deliberation session |
| **Overlay** | Domain-specific additions to an agent's persona (append-only) |
| **Profile** | A complete session configuration (assembly, constraints, delegation, output) |
| **Speaks-Last** | A structural advantage ensuring an agent responds after all others |
| **Tension Pair** | Two agents with designed cognitive conflict, enabling structured disagreement |
| **Transcript** | A JSONL event log capturing every action in a session |
| **Workflow** | A multi-step process with inter-step data flow and quality gates |

---

*This document serves as the comprehensive feature reference for the AOS Harness v0.9.1 and is intended as source material for white paper publication.*
