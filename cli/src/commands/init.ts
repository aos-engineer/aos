/**
 * aos init — Initialize or reconfigure AOS in the current project.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { c, type ParsedArgs } from "../colors";
import { getHarnessRoot, getPackageCoreDir, isValidAdapter } from "../utils";
import { buildAdapterDefaults, getInitEditor, getInitModels, getSelectedAdaptersForInit, parseAdapterList } from "../aos-config";
import { scanEnvironment } from "../env-scanner";
import { mergeConfig, generateMemoryYaml } from "../init-config-writer";
import { applyActions } from "../init-applier";
import { ensureProjectPiGitignore, writeProjectPiShim } from "../pi-extension-setup";
import type { AdapterName } from "../utils";
import type { ScanReport, WizardResult } from "../init-types";
import { runWizard } from "../init-wizard";
import { clackPromptContext } from "../prompts";

function readCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "..", "package.json"), "utf-8");
    return (JSON.parse(raw) as { version: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const HELP = `
${c.bold("aos init")} — Initialize or reconfigure AOS in the current project

${c.bold("USAGE")}
  aos init [--adapter <adapter>] [--force] [--apply] [--non-interactive] [--from-yaml <path>]

${c.bold("OPTIONS")}
  --adapter <name>      Adapter to enable or validate: pi, claude-code, gemini, codex
  --force               Reinitialize config files and recopy core/ if needed
  --apply               Install missing AOS adapter packages after config generation
  --non-interactive     Scan-only mode. Writes .aos/scan.json and validates selected adapters if provided
  --from-yaml <path>    Read a prebuilt WizardResult YAML/JSON file and write config from it

${c.bold("DESCRIPTION")}
  Scans vendor CLI readiness, scans AOS adapter-package readiness, writes
  .aos/config.yaml in v2 shape, and can optionally install missing adapter
  packages. In non-interactive mode without a selected adapter, init is pure
  scan/report and does not write config.
`;

function projectNameFromCwd(cwd: string): string {
  return cwd.split("/").pop()?.toLowerCase().replace(/[^a-z0-9-]/g, "-") ?? "default";
}

function parseWizardResultFile(path: string): WizardResult {
  const parsed = yaml.load(readFileSync(path, "utf-8"), { schema: yaml.JSON_SCHEMA }) as Partial<WizardResult> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Malformed --from-yaml input: expected an object");
  }

  const enabledAdapters = Array.isArray(parsed.enabledAdapters)
    ? parsed.enabledAdapters.filter((value): value is AdapterName => typeof value === "string" && isValidAdapter(value))
    : [];
  const defaultAdapter = typeof parsed.defaultAdapter === "string" && isValidAdapter(parsed.defaultAdapter)
    ? parsed.defaultAdapter
    : null;

  if (enabledAdapters.length === 0 || !defaultAdapter || !enabledAdapters.includes(defaultAdapter)) {
    throw new Error("Malformed --from-yaml input: enabledAdapters/defaultAdapter are invalid");
  }

  return {
    enabledAdapters,
    defaultAdapter,
    memory: {
      provider:
        parsed.memory?.provider === "mempalace" || parsed.memory?.provider === "graphify"
          ? parsed.memory.provider
          : "expertise",
    },
    models: parsed.models ?? getInitModels(process.cwd()),
    adapterDefaults: parsed.adapterDefaults ?? buildAdapterDefaults(enabledAdapters, { legacyPiModels: parsed.models }),
    editor: typeof parsed.editor === "string" ? parsed.editor : getInitEditor(process.cwd()),
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
  };
}

function writeScanReport(aosDir: string, scan: ScanReport): string {
  mkdirSync(aosDir, { recursive: true });
  const scanPath = join(aosDir, "scan.json");
  writeFileSync(scanPath, JSON.stringify(scan, null, 2), "utf-8");
  return scanPath;
}

function printAdapterInstallHints(version: string, packageManager: ScanReport["packageManager"]): void {
  const managers: Array<"bun" | "npm"> = packageManager === "unknown" ? ["bun", "npm"] : [packageManager];
  const renderCommand = (manager: "bun" | "npm", pkg: string) => `${manager} install -g ${pkg}@${version}`;
  const packages = [
    ["Claude Code", "@aos-harness/claude-code-adapter"],
    ["Gemini CLI", "@aos-harness/gemini-adapter"],
    ["Codex CLI", "@aos-harness/codex-adapter"],
    ["Pi", "@aos-harness/pi-adapter"],
  ] as const;

  console.log(`${c.bold("Next step: install an adapter")}
  Adapters augment the AI CLI you already use. Install the AOS adapter package that matches it:
`);

  for (const manager of managers) {
    console.log(`  ${c.bold(manager)}:`);
    for (const [label, pkg] of packages) {
      console.log(`    ${label.padEnd(14)} ${c.cyan(renderCommand(manager, pkg))}`);
    }
    console.log("");
  }

  console.log(`  ${c.dim("Install one (or more) that matches the vendor CLI you already have.")}`);
}

function backupCorruptedConfig(configPath: string): string {
  const backupPath = `${configPath}.backup.${Date.now()}`;
  cpSync(configPath, backupPath);
  return backupPath;
}

export async function initCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    console.log(HELP);
    return;
  }

  const cwd = process.cwd();
  const aosDir = join(cwd, ".aos");
  const configPath = join(aosDir, "config.yaml");
  const memoryPath = join(aosDir, "memory.yaml");
  const force = !!args.flags.force;
  const apply = !!args.flags.apply;
  const isInteractive = !!(process.stdin.isTTY && process.stdout.isTTY);
  const fromYamlPath = typeof args.flags["from-yaml"] === "string" ? args.flags["from-yaml"] : null;
  const explicitAdapters = parseAdapterList(args.flags.adapter);

  if (!isInteractive && !args.flags["non-interactive"] && !fromYamlPath) {
    console.error('Pass --from-yaml=<path> or --non-interactive');
    process.exit(2);
  }

  const scan = await scanEnvironment({ cwd });
  const scanPath = writeScanReport(aosDir, scan);

  if (args.flags["non-interactive"] && !fromYamlPath) {
    const selected = explicitAdapters.length > 0 ? explicitAdapters : getSelectedAdaptersForInit(cwd, args.flags.adapter);
    if (selected.length === 0) {
      console.log(`${c.green("Scan complete.")} Report: ${c.cyan(scanPath)}`);
      return;
    }

    const notReady = selected.filter((adapter) => scan.adapters[adapter].status !== "ready");
    if (notReady.length > 0) {
      console.error(c.red(`Selected adapters are not ready: ${notReady.join(", ")}`));
      for (const adapter of notReady) {
        console.error(c.dim(`  ${adapter}: ${scan.adapters[adapter].statusHint}`));
      }
      process.exit(3);
    }

    console.log(`${c.green("Selected adapters are ready.")} Report: ${c.cyan(scanPath)}`);
    return;
  }

  let wizardResult: WizardResult;
  if (fromYamlPath) {
    try {
      wizardResult = parseWizardResultFile(fromYamlPath);
    } catch (error) {
      console.error(c.red(error instanceof Error ? error.message : String(error)));
      process.exit(2);
    }
  } else {
    const interactiveResult = await runWizard(scan, cwd, args.flags.adapter);
    if (!interactiveResult) return;
    wizardResult = interactiveResult;
  }

  mkdirSync(aosDir, { recursive: true });
  let renderedConfig: string;
  try {
    renderedConfig = mergeConfig(cwd, wizardResult, scan.packageManager);
  } catch (error) {
    if (force && existsSync(configPath)) {
      const backupPath = backupCorruptedConfig(configPath);
      console.log(c.yellow(`Backed up invalid config to ${backupPath}`));
      renderedConfig = mergeConfig(cwd, wizardResult, scan.packageManager, { ignoreExisting: true });
    } else {
      console.error(c.red(`Existing .aos/config.yaml could not be parsed: ${error instanceof Error ? error.message : String(error)}`));
      console.error(c.dim(`Run "aos init --force" to back it up and rewrite the file.`));
      process.exit(2);
    }
  }
  writeFileSync(configPath, renderedConfig, "utf-8");

  const projectName = projectNameFromCwd(cwd);
  if (!existsSync(memoryPath) || force) {
    writeFileSync(memoryPath, generateMemoryYaml(projectName, wizardResult.memory.provider), "utf-8");
  }

  const destCore = join(cwd, "core");
  if (!existsSync(destCore) || force) {
    const sourceCore = getPackageCoreDir() ?? join(getHarnessRoot(), "core");
    if (existsSync(join(sourceCore, "agents"))) {
      cpSync(sourceCore, destCore, { recursive: true });
      console.log(c.green("  Copied core configs (agents, profiles, domains, workflows, skills)"));
    } else {
      console.log(c.yellow("  Warning: Could not find core configs to copy."));
    }
  }

  let piShimPath: string | null = null;
  if (wizardResult.enabledAdapters.includes("pi")) {
    piShimPath = writeProjectPiShim(cwd);
    ensureProjectPiGitignore(cwd);
    console.log(c.green("  Installed Pi extension shim (.pi/extensions/aos-harness.ts)"));
  }

  console.log(`
${c.green("AOS initialized successfully!")}

${c.bold("Configuration")}
  Directory: ${c.cyan(aosDir)}
  Config:    ${c.cyan(configPath)}
  Adapter:   ${c.cyan(wizardResult.defaultAdapter)}
  Scan:      ${c.cyan(scanPath)}
${piShimPath ? `  Pi shim:   ${c.cyan(piShimPath)}\n` : ""}
`);

  printAdapterInstallHints(readCliVersion(), scan.packageManager);

  const installable = wizardResult.actions.filter((action) => action.type === "install-adapter");
  let shouldApply = apply;
  if (!apply && isInteractive && installable.length > 0) {
    const applyNow = await clackPromptContext.confirm({
      message: `Install ${installable.length} missing adapter package${installable.length === 1 ? "" : "s"} now?`,
      initialValue: false,
    });
    if (clackPromptContext.isCancel(applyNow)) {
      clackPromptContext.cancel("Operation cancelled.");
      process.exit(130);
    }
    shouldApply = !!applyNow;
  }

  if (shouldApply) {
    const result = await applyActions(wizardResult.actions);
    if (!result.ok) {
      console.error(c.red(`Some installs failed: ${result.failures.join(", ")}`));
      process.exit(1);
    }
  } else {
    if (installable.length > 0) {
      console.log(c.dim(`Run "aos init --apply" to install missing adapter packages with ${scan.packageManager}.`));
    }
  }
}
