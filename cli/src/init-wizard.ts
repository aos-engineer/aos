import {
  buildAdapterDefaults,
  getDefaultAdapterFromConfig,
  getInitEditor,
  getInitMemoryProvider,
  getInitModels,
  getSelectedAdaptersForInit,
  listKnownAdapters,
  readAosConfig,
} from "./aos-config";
import { readAdapterConfig } from "./adapter-config";
import { ADAPTER_METADATA } from "./env-scanner";
import { clackPromptContext, renderScanReport, type PromptContext } from "./prompts";
import type { ScanReport, WizardAction, WizardResult } from "./init-types";
import type { AdapterName } from "./utils";

export function buildActions(scan: ScanReport, enabledAdapters: AdapterName[]): WizardAction[] {
  const actions: WizardAction[] = [];

  for (const adapter of enabledAdapters) {
    const readiness = scan.adapters[adapter];
    const meta = ADAPTER_METADATA[adapter];

    if ((readiness.status === "needs-adapter" || readiness.status === "broken") && scan.packageManager !== "unknown") {
      actions.push({
        type: "install-adapter",
        packageName: meta.packageName,
        manager: scan.packageManager,
        global: true,
      });
    }

    if (readiness.status === "needs-login") {
      actions.push({
        type: "info-login",
        adapter,
        vendorCommand: readiness.vendorCli.auth.hint ?? meta.loginHint,
      });
    }

    if (readiness.status === "needs-cli") {
      actions.push({
        type: "info-install-vendor-cli",
        adapter,
        url: meta.installUrl,
      });
    }
  }

  return actions;
}

function requirePromptValue<T>(value: T | symbol, promptContext: PromptContext): T {
  if (promptContext.isCancel(value)) {
    promptContext.cancel("Operation cancelled.");
    process.exit(130);
  }
  return value as T;
}

function renderActionSummary(actions: WizardAction[]): string[] {
  if (actions.length === 0) return ["Actions: none"];

  return [
    "Actions:",
    ...actions.map((action) => {
      if (action.type === "install-adapter") {
        return `  install ${action.packageName} with ${action.manager}`;
      }
      if (action.type === "info-login") {
        return `  login ${action.adapter}: ${action.vendorCommand}`;
      }
      return `  vendor CLI ${action.adapter}: ${action.url}`;
    }),
  ];
}

function deriveRecommendedAdapters(scan: ScanReport): AdapterName[] {
  return listKnownAdapters().filter((adapter) => {
    const status = scan.adapters[adapter].status;
    return status === "ready" || status === "needs-adapter" || status === "needs-login";
  });
}

function orderedUniqueAdapters(adapters: AdapterName[]): AdapterName[] {
  const seen = new Set<AdapterName>();
  const values: AdapterName[] = [];
  for (const adapter of adapters) {
    if (!seen.has(adapter)) {
      seen.add(adapter);
      values.push(adapter);
    }
  }
  return values;
}

export async function runWizard(
  scan: ScanReport,
  cwd: string,
  flagAdapter?: string | boolean,
  promptContext: PromptContext = clackPromptContext,
): Promise<WizardResult | null> {
  promptContext.intro("AOS init");
  promptContext.note(renderScanReport(scan), "Environment Scan");

  const existingConfig = readAosConfig(cwd);
  const adapterConfig = readAdapterConfig(cwd);
  const existingSelected = getSelectedAdaptersForInit(cwd, flagAdapter);
  const configuredDefault = getDefaultAdapterFromConfig(existingConfig)
    ?? (typeof adapterConfig?.platform === "string" ? adapterConfig.platform as AdapterName : null);
  const existingMemoryProvider = getInitMemoryProvider(cwd);
  const recommended = deriveRecommendedAdapters(scan);
  const explicitSelection = typeof flagAdapter === "string" && flagAdapter.trim().length > 0;

  let enabled: AdapterName[];
  if (explicitSelection || existingSelected.length === 0) {
    const initialValues = existingSelected.length > 0 ? existingSelected : recommended;
    enabled = requirePromptValue(
      await promptContext.multiselect<AdapterName>({
        message: "Select the adapters to enable",
        options: listKnownAdapters().map((adapter) => ({
          value: adapter,
          label: adapter,
          hint: scan.adapters[adapter].statusHint,
        })),
        initialValues,
        required: true,
      }),
      promptContext,
    );
  } else {
    enabled = [...existingSelected];

    for (const adapter of recommended) {
      if (enabled.includes(adapter)) continue;
      const shouldEnable = requirePromptValue(
        await promptContext.confirm({
          message: `Enable ${adapter}? ${scan.adapters[adapter].statusHint}`,
          initialValue: true,
        }),
        promptContext,
      );
      if (shouldEnable) {
        enabled.push(adapter);
      }
    }

    for (const adapter of existingSelected) {
      if (recommended.includes(adapter)) continue;
      const shouldDisable = requirePromptValue(
        await promptContext.confirm({
          message: `Disable ${adapter}? ${scan.adapters[adapter].statusHint}`,
          initialValue: false,
        }),
        promptContext,
      );
      if (shouldDisable) {
        enabled = enabled.filter((value) => value !== adapter);
      }
    }

    enabled = orderedUniqueAdapters(enabled);
  }
  if (!enabled || enabled.length === 0) {
    throw new Error("At least one adapter must be enabled.");
  }

  let defaultAdapter: AdapterName;
  if (!explicitSelection && configuredDefault && enabled.includes(configuredDefault)) {
    defaultAdapter = configuredDefault;
  } else {
    defaultAdapter = requirePromptValue(
      await promptContext.select<AdapterName>({
        message: "Choose the default adapter",
        options: enabled.map((adapter) => ({
          value: adapter,
          label: adapter,
          hint: scan.adapters[adapter].statusHint,
        })),
        initialValue: enabled[0],
      }),
      promptContext,
    );
  }

  const recommendedMemoryProvider = scan.memory.mempalace.available ? "mempalace" : "expertise";
  let memoryProvider: "expertise" | "mempalace" | "graphify";
  if (existingMemoryProvider && existingMemoryProvider === recommendedMemoryProvider) {
    memoryProvider = existingMemoryProvider;
  } else {
    const initialMemoryProvider = existingMemoryProvider ?? recommendedMemoryProvider;
    memoryProvider = requirePromptValue(
      await promptContext.select<"expertise" | "mempalace" | "graphify">({
        message: "Choose the memory provider",
        options: [
          {
            value: "mempalace",
            label: "mempalace",
            hint: scan.memory.mempalace.available
              ? "MemPalace socket detected"
              : "Configure MemPalace later",
          },
          {
            value: "graphify",
            label: "graphify",
            hint: scan.memory.graphify.available
              ? "graphify CLI detected — knowledge-graph recall"
              : "Knowledge-graph recall (install graphifyy + build a graph)",
          },
          {
            value: "expertise",
            label: "expertise",
            hint: scan.memory.mempalace.available
              ? "Built-in fallback"
              : "Built-in fallback recommended right now",
          },
        ],
        initialValue: initialMemoryProvider,
      }),
      promptContext,
    );
  }

  const actions = buildActions(scan, enabled);
  promptContext.note(
    [
      `Enabled adapters: ${enabled.join(", ")}`,
      `Default adapter: ${defaultAdapter}`,
      `Memory provider: ${memoryProvider}`,
      ...renderActionSummary(actions),
    ].join("\n"),
    "Init Plan",
  );

  const confirmation = requirePromptValue(
    await promptContext.confirm({
      message: "Write these init settings to .aos/config.yaml?",
      initialValue: true,
    }),
    promptContext,
  );
  if (!confirmation) {
    promptContext.outro("No changes written.");
    return null;
  }

  promptContext.outro("Init choices captured.");

  const adapterDefaults = buildAdapterDefaults(enabled, { legacyPiModels: getInitModels(cwd) });

  return {
    enabledAdapters: enabled,
    defaultAdapter,
    memory: {
      provider: memoryProvider,
    },
    models: getInitModels(cwd),
    adapterDefaults,
    editor: getInitEditor(cwd),
    actions,
  };
}
