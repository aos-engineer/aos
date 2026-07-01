/**
 * aos run — Launch a deliberation or execution session.
 */

import { existsSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { c, type ParsedArgs } from "../colors";
import { getHarnessRoot, discoverDirs, promptSelect, getAdapterDir, ADAPTER_ALLOWLIST, isValidAdapter, validatePlatformUrl, parseAllowCodeExecutionFlag } from "../utils";
import { runAdapterSession } from "../adapter-session";
import { buildToolPolicy, type ToolPolicy } from "@aos-harness/adapter-shared";
import { getPlatformUrlFromConfig, getRuntimeAdapterModelConfig, resolveAdapterSelection } from "../aos-config";
import { backfillAdapterDefaults } from "../config-migration";
import { ADAPTER_METADATA, scanEnvironment } from "../env-scanner";
import { hasPiExtensionShim } from "../pi-extension-setup";

const HELP = `
${c.bold("aos run")} — Run a deliberation or execution session

${c.bold("USAGE")}
  aos run [profile] [--domain <domain>] [--brief <path>] [--verbose] [--dry-run]
                    [--workflow-dir <path>] [--yes]

${c.bold("OPTIONS")}
  --domain <name>       Domain pack to apply (e.g. saas)
  --brief <path>        Path to the brief file
  --verbose             Stream engine decisions to stderr
  --dry-run             Validate config and print simulation summary without launching
  --yes                 Auto-approve execution-workflow review gates (non-interactive/CI)
  --workflow-dir <path> Directory containing workflow YAML files (default: core/workflows/)
  --platform-url <url> Platform API URL for live observability (e.g. http://localhost:3001)
  --allow-code-execution[=<langs>|none]
                        Narrow (never widen) the profile's code-execution allowlist
                        for this session. Pass \`none\` to force-deny; pass a comma
                        list like \`python,bash\` to intersect with the profile.

${c.bold("DESCRIPTION")}
  Launches a deliberation or execution session using the specified profile.
  If the profile has a "workflow" field, it runs as an execution profile
  using the linked workflow definition. Otherwise, it runs as a standard
  deliberation session.

  If no profile is given, lists available profiles and prompts for selection.
  If no brief is given, lists available briefs and prompts for selection.

  The session is launched via the configured adapter (default: Pi CLI).

${c.bold("EXAMPLES")}
  aos run strategic-council
  aos run cto-execution --brief briefs/my-feature.md
  aos run strategic-council --domain saas --brief briefs/my-brief.md
  aos run strategic-council --dry-run --brief core/briefs/sample-product-decision/brief.md
  aos run  # interactive profile selection
`;

function readCliVersion(): string {
  try {
    const raw = readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf-8");
    return (JSON.parse(raw) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function versionMismatchSeverity(cliVer: string, adapterVer?: string): "none" | "warn" {
  if (!adapterVer) return "none";
  const [cliMaj, cliMin] = cliVer.split(".").map(Number);
  const [adaMaj, adaMin] = adapterVer.split(".").map(Number);
  if (Number.isNaN(cliMaj) || Number.isNaN(adaMaj)) return "none";
  if (cliMaj !== adaMaj) return "warn";
  if (cliMin !== adaMin) return "warn";
  return "none";
}

async function probeClaudeExternalApiKey(): Promise<{ ok: boolean; hint?: string }> {
  const proc = Bun.spawn(["claude", "--print", "Reply with OK."], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, 15000);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const combined = `${stdout}\n${stderr}`.trim();
    if (timedOut) {
      return { ok: true, hint: "Claude auth probe timed out; continuing without blocking launch." };
    }
    if (exitCode === 0) {
      return { ok: true };
    }
    if (/invalid api key|fix external api key|api key/i.test(combined)) {
      return {
        ok: false,
        hint: "Claude Code external API-key auth failed. Unset or refresh ANTHROPIC_API_KEY, or switch back to `claude login` auth before running AOS.",
      };
    }
    return { ok: true, hint: combined ? `Claude auth probe returned: ${combined.split("\n")[0]}` : undefined };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    console.log(HELP);
    return;
  }

  // Validate --adapter flag early (spec D2) before any project resolution so
  // unknown names are rejected regardless of workspace state.
  if (args.flags["adapter"]) {
    const flagAdapter = args.flags["adapter"] as string;
    if (!isValidAdapter(flagAdapter)) {
      console.error(c.red(`Unknown adapter: ${flagAdapter}`));
      console.error(c.dim(`Allowed: ${ADAPTER_ALLOWLIST.join(", ")}`));
      process.exit(2);
    }
  }

  const root = getHarnessRoot();
  const coreDir = join(root, "core");
  const migration = backfillAdapterDefaults(root);
  if (migration.changed) {
    console.error(c.dim(`Migrated ${migration.path} to add adapter_defaults.`));
  }

  // ── Resolve profile ──────────────────────────────────────────
  let profileName = args.positional[0] || null;

  const profileDirs = discoverDirs(join(coreDir, "profiles"), "profile.yaml");
  const profileNames = profileDirs.map((d) => basename(d));

  if (!profileName) {
    if (profileNames.length === 0) {
      console.error(c.red("No profiles found. Create one with: aos create profile <name>"));
      process.exit(1);
    }
    const idx = await promptSelect("Select a profile:", profileNames);
    profileName = profileNames[idx];
  }

  const profileDir = profileDirs.find((d) => basename(d) === profileName);
  if (!profileDir) {
    console.error(c.red(`Profile "${profileName}" not found. Available profiles: ${profileNames.join(", ")}`));
    process.exit(1);
  }

  // ── Resolve domain ───────────────────────────────────────────
  const domainName = (args.flags.domain as string) || null;
  if (domainName) {
    const domainDir = join(coreDir, "domains", domainName);
    if (!existsSync(join(domainDir, "domain.yaml"))) {
      const availableDomains = discoverDirs(join(coreDir, "domains"), "domain.yaml").map((d) => basename(d));
      console.error(c.red(`Domain "${domainName}" not found. Available domains: ${availableDomains.join(", ") || "none"}`));
      process.exit(1);
    }
  }

  // ── Resolve brief ────────────────────────────────────────────
  let briefPath = (args.flags.brief as string) || null;

  if (!briefPath) {
    // Discover available briefs
    const briefsDir = join(coreDir, "briefs");
    const briefOptions: { name: string; path: string }[] = [];

    if (existsSync(briefsDir)) {
      for (const entry of readdirSync(briefsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const bp = join(briefsDir, entry.name, "brief.md");
        if (existsSync(bp)) {
          briefOptions.push({ name: entry.name, path: bp });
        }
      }
    }

    if (briefOptions.length === 0) {
      console.error(c.red("No briefs found. Create a brief.md file and pass it with --brief <path>."));
      process.exit(1);
    }

    const idx = await promptSelect(
      "Select a brief:",
      briefOptions.map((b) => b.name),
    );
    briefPath = briefOptions[idx].path;
  } else {
    // Resolve relative paths
    if (!briefPath.startsWith("/")) {
      briefPath = resolve(process.cwd(), briefPath);
    }
    if (!existsSync(briefPath)) {
      console.error(c.red(`Brief file not found: ${briefPath}`));
      process.exit(1);
    }
  }

  // ── Resolve workflow directory ───────────────────────────────
  const workflowsDir = (args.flags["workflow-dir"] as string)
    ? resolve(process.cwd(), args.flags["workflow-dir"] as string)
    : join(coreDir, "workflows");

  // ── Validate brief against profile ───────────────────────────
  const { loadProfile, loadWorkflow, resolveWorkflowFile, validateBrief } = await import("@aos-harness/runtime/config-loader");
  let profile: ReturnType<typeof loadProfile>;
  try {
    profile = loadProfile(profileDir);
  } catch (err: any) {
    // Malformed `tools:` block (and any other profile-schema failure) comes
    // through as a ConfigError. Surface as exit 3 per spec D6 so CI can
    // distinguish policy/config errors from runtime errors (exit 1) and
    // invalid input (exit 2).
    if (err?.name === "ConfigError") {
      console.error(c.red(err.message));
      process.exit(3);
    }
    throw err;
  }

  // ── Resolve tool policy (spec D3.2) ─────────────────────────
  // Profile's `tools:` block is the ceiling; the CLI flag can narrow but
  // never widen. Any widening attempt from buildToolPolicy is exit 3.
  const allowCodeExec = parseAllowCodeExecutionFlag(args.flags["allow-code-execution"]);
  let toolPolicy: ToolPolicy;
  try {
    toolPolicy = buildToolPolicy(profile.tools!, { allowCodeExecution: allowCodeExec });
  } catch (err: any) {
    console.error(c.red(err.message));
    process.exit(3);
  }

  // ── Detect execution profile (has workflow field) ──────────
  const isExecutionProfile = !!profile.workflow;

  // Brief lint is advisory. The existing profile section validation below
  // remains the blocking compatibility check for run.
  try {
    const briefContent = readFileSync(briefPath, "utf-8");
    const expectedKind: "deliberation" | "execution" = isExecutionProfile ? "execution" : "deliberation";
    const { validateBrief: validateBriefShape } = await import("../brief/validate");
    const briefValidation = validateBriefShape(briefContent, { expectedKind });
    const errCount = briefValidation.errors.length;
    const warnCount = briefValidation.warnings.length;
    if (errCount === 0 && warnCount === 0) {
      console.error(c.dim(`Brief lint: ${expectedKind} brief looks good (0 errors, 0 warnings).`));
    } else {
      console.error(c.yellow(`Brief lint: ${errCount} error${errCount === 1 ? "" : "s"}, ${warnCount} warning${warnCount === 1 ? "" : "s"}.`));
      console.error(c.dim(`  Run \`aos brief validate ${briefPath}\` for details, or \`aos create brief\` to author from a template.`));
    }
  } catch (err) {
    console.error(c.dim(`(brief lint skipped: ${(err as Error).message})`));
  }

  const validation = validateBrief(briefPath, profile.input.required_sections);

  let workflowConfig: Awaited<ReturnType<typeof loadWorkflow>> | null = null;

  if (isExecutionProfile) {
    // Resolve workflow file from workflowsDir via the shared resolver so the
    // CLI, the engine, and `aos validate` all agree on where a workflow lives
    // (flat `<name>.workflow.yaml` and the `<id>/workflow.yaml` dir convention).
    const workflowId = profile.workflow!;
    try {
      workflowConfig = loadWorkflow(resolveWorkflowFile(workflowsDir, workflowId));
    } catch {
      const available = existsSync(workflowsDir)
        ? readdirSync(workflowsDir).filter((f) => f.endsWith(".workflow.yaml"))
        : [];
      console.error(c.red(`Workflow "${workflowId}" not found in ${workflowsDir}`));
      console.error(c.yellow(`Available workflow files: ${available.join(", ") || "none"}`));
      process.exit(1);
    }
  }

  if (!validation.valid) {
    console.error(c.red("Brief validation failed. Missing required sections:"));
    for (const section of validation.missing) {
      console.error(c.red(`  - ${section.heading}: ${section.guidance}`));
    }
    console.error(c.yellow(`\nAdd the missing sections to your brief and try again.`));
    process.exit(1);
  }

  // ── Dry-run mode ─────────────────────────────────────────────
  if (args.flags["dry-run"]) {
    const briefContent = readFileSync(briefPath, "utf-8");
    const briefSections = briefContent.match(/^##\s+.+/gm) || [];

    const agentIds = [
      profile.assembly.orchestrator,
      ...profile.assembly.perspectives.map((p: { agent: string }) => p.agent),
    ];
    const requiredCount = profile.assembly.perspectives.filter((p: { required: boolean }) => p.required).length;
    const optionalCount = profile.assembly.perspectives.length - requiredCount;

    const constraints = profile.constraints;
    const budgetMin = constraints.budget ? `$${constraints.budget.min.toFixed(2)}` : "N/A (unmetered)";
    const budgetMax = constraints.budget ? `$${constraints.budget.max.toFixed(2)}` : "N/A (unmetered)";

    let workflowSection = "";
    if (isExecutionProfile && workflowConfig) {
      const stepSummary = workflowConfig.steps
        .map((s) =>
          `    ${s.id.padEnd(20)} ${(s.name ?? s.id).padEnd(30)} ${s.action}${s.review_gate ? " [gate]" : ""}`
        )
        .join("\n");
      const gateCount = workflowConfig.gates?.length || 0;
      workflowSection = `
${c.bold("Workflow")} ${c.magenta("(execution profile)")}
  ID:             ${c.cyan(workflowConfig.id)}
  Name:           ${workflowConfig.name}
  Steps:          ${workflowConfig.steps.length}
  Gates:          ${gateCount}
  Workflows dir:  ${workflowsDir}

${c.bold("  Step Details")}
${stepSummary}
`;
    }

    console.log(`
${c.bold("DRY RUN — Simulation Summary")}

${c.bold("Profile")}
  Name:           ${c.cyan(profile.name)}
  ID:             ${profile.id}
  Type:           ${isExecutionProfile ? c.magenta("execution") : c.cyan("deliberation")}
  Description:    ${profile.description || "none"}

${c.bold("Assembly")}
  Orchestrator:   ${c.cyan(profile.assembly.orchestrator)}
  Agents:         ${agentIds.length} total (1 orchestrator + ${requiredCount} required + ${optionalCount} optional)
  Agent IDs:      ${agentIds.join(", ")}

${c.bold("Constraints")}
  Time:           ${constraints.time.min_minutes}–${constraints.time.max_minutes} minutes
  Budget:         ${budgetMin}–${budgetMax}
  Rounds:         ${constraints.rounds.min}–${constraints.rounds.max}

${c.bold("Delegation")}
  Default:        ${profile.delegation.default}
  Tension pairs:  ${profile.delegation.tension_pairs.length}
  Bias limit:     ${profile.delegation.bias_limit}
  Opening rounds: ${profile.delegation.opening_rounds}
${workflowSection}
${c.bold("Brief")}
  Path:           ${briefPath}
  Sections found: ${briefSections.length > 0 ? briefSections.map((s: string) => s.replace(/^##\s+/, "")).join(", ") : "none"}

${c.bold("Domain")}
  Domain:         ${domainName || "none"}

${c.bold("Estimated Cost Range")}
  Minimum:        ${budgetMin}
  Maximum:        ${budgetMax}

${c.green("All configuration validated successfully. Ready to launch.")}
`);
    process.exit(0);
  }

  // Determine adapter with shared precedence so init/run agree:
  // --adapter > config v2 > config v1 > .aos/adapter.yaml > default "pi"
  let platformUrl = (args.flags["platform-url"] as string) || null;
  const { adapter } = resolveAdapterSelection(process.cwd(), args.flags["adapter"]);
  if (!platformUrl) {
    platformUrl = getPlatformUrlFromConfig(process.cwd());
  }

  // Validate platform URL (spec D5). Fires for both --platform-url flag
  // and .aos/config.yaml platform.url after both sources are merged.
  if (platformUrl) {
    try {
      validatePlatformUrl(platformUrl);
    } catch (err: any) {
      console.error(c.red(`Invalid platform.url: ${err.message}`));
      process.exit(2);
    }
  }

  if (!isValidAdapter(adapter)) {
    console.error(c.red(`Unknown adapter: ${adapter}`));
    console.error(c.dim(`Allowed: ${ADAPTER_ALLOWLIST.join(", ")}`));
    process.exit(2);
  }

  if (adapter !== "pi") {
    const scan = await scanEnvironment({ cwd: process.cwd() });
    const readiness = scan.adapters[adapter];
    const meta = ADAPTER_METADATA[adapter];

    if (readiness.status !== "ready") {
      console.error(c.red(`${meta.label} is not ready for \`aos run\`.`));
      console.error(c.red(`  ${readiness.statusHint}`));
      if (scan.notes.length > 0) {
        for (const note of scan.notes.filter((entry) => entry.startsWith(`${adapter}:`))) {
          console.error(c.dim(`  ${note}`));
        }
      }
      process.exit(2);
    }

    const cliVersion = readCliVersion();
    if (versionMismatchSeverity(cliVersion, readiness.aosAdapter.version) === "warn") {
      const installHint = readiness.aosAdapter.store === "bun"
        ? `bun add -g ${meta.packageName}@${cliVersion}`
        : `npm i -g ${meta.packageName}@${cliVersion}`;
      console.error(c.yellow(`⚠ Version mismatch before launch: aos-harness@${cliVersion} and ${meta.packageName}@${readiness.aosAdapter.version}`));
      console.error(c.dim(`  Install matching versions: ${installHint}`));
    }

    if (readiness.statusHint.includes("ANTHROPIC_API_KEY")) {
      console.error(c.yellow(`⚠ ${readiness.statusHint}`));
      if (adapter === "claude-code") {
        const authProbe = await probeClaudeExternalApiKey();
        if (!authProbe.ok) {
          console.error(c.red(`Claude Code auth preflight failed.`));
          console.error(c.red(`  ${authProbe.hint}`));
          process.exit(2);
        }
        if (authProbe.hint) {
          console.error(c.dim(`  ${authProbe.hint}`));
        }
      }
    }
  }

  const adapterName = adapter;
  // Resolve from monorepo dev layout (CLI's own import.meta.dir) or installed
  // @aos-harness/<name>-adapter. Project-local override is intentionally absent
  // (spec D1 — workspace-trust hardening).
  const resolvedAdapterDir = getAdapterDir(adapterName);

  // ── Set up deliberation directory for artifact storage ──────
  const sessionId = `${new Date().toISOString().slice(0, 10)}-${profileName}-${Date.now().toString(36)}`;
  const deliberationDir = join(root, ".aos", "sessions", sessionId);
  mkdirSync(deliberationDir, { recursive: true });

  // ── Launch adapter ───────────────────────────────────────────
  const sessionType = isExecutionProfile ? "Execution" : "Deliberation";
  console.log(`
${c.bold(`AOS ${sessionType} Session`)}
  Profile:  ${c.cyan(profileName!)}
  Type:     ${isExecutionProfile ? c.magenta("execution") : c.cyan("deliberation")}${isExecutionProfile && workflowConfig ? `\n  Workflow: ${c.magenta(workflowConfig.id)} (${workflowConfig.steps.length} steps)` : ""}
  Domain:   ${c.cyan(domainName || "none")}
  Brief:    ${c.cyan(briefPath)}
  Output:   ${c.cyan(deliberationDir)}
`);

  if (adapter === "pi") {
    const adapterEntry = resolvedAdapterDir ? join(resolvedAdapterDir, "src", "index.ts") : null;
    const useDiscoveredExtension = hasPiExtensionShim(root);
    if (!adapterEntry || !existsSync(adapterEntry)) {
      console.error(c.red(`Pi adapter not found.`));
      console.error(c.yellow("Make sure Pi CLI is installed: https://pi.dev (source: https://github.com/badlogic/pi-mono)"));
      console.error(c.dim("Install the adapter package:"));
      console.error(c.dim("  npm i -g @aos-harness/pi-adapter"));
      console.error(c.dim("  # or in a project: npm i @aos-harness/pi-adapter"));
      process.exit(2);
    }

    const piArgs = useDiscoveredExtension
      ? ["/aos-run"]
      : ["-e", adapterEntry, "/aos-run"];

    console.log(c.dim(`Launching Pi adapter...`));
    console.log(c.dim(`  pi ${piArgs.join(" ")}`));
    console.log();

    // Set environment variables for the adapter
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      AOS_PROFILE: profileName!,
      AOS_BRIEF: briefPath,
      AOS_HARNESS_ROOT: root,
      AOS_SESSION_ID: sessionId,
      AOS_DELIBERATION_DIR: deliberationDir,
    };
    if (domainName) {
      env.AOS_DOMAIN = domainName;
    }
    if (args.flags.verbose) {
      env.AOS_VERBOSE = "1";
    }
    if (platformUrl) {
      env.AOS_PLATFORM_URL = platformUrl;
    }
    if (isExecutionProfile && workflowConfig) {
      env.AOS_WORKFLOW_ID = workflowConfig.id;
      env.AOS_WORKFLOWS_DIR = workflowsDir;
    }
    if (args.flags.yes) {
      env.AOS_AUTO_APPROVE = "1";
    }
    // Pass the resolved ToolPolicy to the Pi adapter as JSON. The Pi adapter
    // runs in a separate process; this env var is the contract consumed by
    // BaseWorkflow for tool gating and tool-denied transcript events.
    env.AOS_TOOL_POLICY_JSON = JSON.stringify(toolPolicy);

    const proc = Bun.spawn(["pi", ...piArgs], {
      cwd: root,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log(`\n${c.green("Session complete.")} Output: ${c.cyan(deliberationDir)}`);
    }
    process.exit(exitCode);
  } else {
    const runtimeModelConfig = getRuntimeAdapterModelConfig(root, adapter);
    await runAdapterSession({
      platform: adapter,
      profileDir: profileDir!,
      briefPath,
      domainName,
      root,
      sessionId,
      deliberationDir,
      verbose: !!args.flags.verbose,
      workflowConfig: isExecutionProfile ? workflowConfig : null,
      workflowsDir,
      modelOverrides: runtimeModelConfig.modelOverrides,
      useVendorDefaultModel: runtimeModelConfig.useVendorDefaultModel,
      toolPolicy,
      platformUrl: platformUrl ?? undefined,
      autoApprove: !!args.flags.yes,
      agentTimeoutMs:
        typeof profile.error_handling?.agent_timeout_seconds === "number"
          ? profile.error_handling.agent_timeout_seconds * 1000
          : undefined,
    });
  }
}
