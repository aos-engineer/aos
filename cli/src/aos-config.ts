import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { readAdapterConfig } from "./adapter-config";
import { ADAPTER_ALLOWLIST, type AdapterName, isValidAdapter } from "./utils";
import type { AdapterModelDefaults, InitModels } from "./init-types";
import type { ModelTier } from "@aos-harness/runtime/types";

export interface AdapterModelSettings {
  use_vendor_default_model?: boolean;
  models?: Partial<InitModels>;
}

export interface AosConfigV2 {
  api_version?: string;
  adapters?: {
    enabled?: string[];
    default?: string;
  };
  adapter_defaults?: Partial<Record<AdapterName, AdapterModelSettings>>;
  package_manager?: string;
  models?: Partial<InitModels>;
  editor?: string;
  platform?: {
    enabled?: boolean;
    url?: string;
  };
}

export interface AosConfigV1 {
  adapter?: string;
  models?: Partial<InitModels>;
  editor?: string;
  platform?: {
    enabled?: boolean;
    url?: string;
  };
}

export type AosConfig = AosConfigV1 & AosConfigV2 & Record<string, unknown>;

export interface AdapterResolution {
  adapter: AdapterName;
  source: "flag" | "config-v2" | "config-v1" | "adapter-yaml" | "default";
}

export interface RuntimeAdapterModelConfig {
  useVendorDefaultModel: boolean;
  modelOverrides?: Partial<Record<ModelTier, string>>;
  source: "config-v2" | "config-v1-pi-models" | "adapter-yaml" | "default";
}

export function readAosConfig(root: string): AosConfig | null {
  const path = join(root, ".aos", "config.yaml");
  if (!existsSync(path)) return null;
  const parsed = yaml.load(readFileSync(path, "utf-8"), { schema: yaml.JSON_SCHEMA }) as AosConfig | null;
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

export function isAosConfigV2(config: AosConfig | null): boolean {
  return !!config && config.api_version === "aos/config/v2";
}

export function parseAdapterList(value: unknown): AdapterName[] {
  if (typeof value !== "string") return [];
  const seen = new Set<AdapterName>();
  for (const raw of value.split(",")) {
    const candidate = raw.trim();
    if (isValidAdapter(candidate)) seen.add(candidate);
  }
  return [...seen];
}

export function getEnabledAdaptersFromConfig(config: AosConfig | null): AdapterName[] {
  if (!config) return [];
  if (isAosConfigV2(config)) {
    const enabled = Array.isArray(config.adapters?.enabled) ? config.adapters?.enabled : [];
    return enabled.filter((value): value is AdapterName => isValidAdapter(value));
  }
  return typeof config.adapter === "string" && isValidAdapter(config.adapter) ? [config.adapter] : [];
}

export function getDefaultAdapterFromConfig(config: AosConfig | null): AdapterName | null {
  if (!config) return null;
  if (isAosConfigV2(config)) {
    if (typeof config.adapters?.default === "string" && isValidAdapter(config.adapters.default)) {
      return config.adapters.default;
    }
    const enabled = getEnabledAdaptersFromConfig(config);
    return enabled[0] ?? null;
  }
  return typeof config.adapter === "string" && isValidAdapter(config.adapter) ? config.adapter : null;
}

export function resolveAdapterSelection(root: string, flagAdapter?: string | boolean): AdapterResolution {
  if (typeof flagAdapter === "string" && isValidAdapter(flagAdapter)) {
    return { adapter: flagAdapter, source: "flag" };
  }

  const aosConfig = readAosConfig(root);
  if (aosConfig) {
    const v2Default = isAosConfigV2(aosConfig) ? getDefaultAdapterFromConfig(aosConfig) : null;
    if (v2Default) return { adapter: v2Default, source: "config-v2" };

    if (typeof aosConfig.adapter === "string" && isValidAdapter(aosConfig.adapter)) {
      return { adapter: aosConfig.adapter, source: "config-v1" };
    }
  }

  const adapterConfig = readAdapterConfig(root);
  if (typeof adapterConfig?.platform === "string" && isValidAdapter(adapterConfig.platform)) {
    return { adapter: adapterConfig.platform, source: "adapter-yaml" };
  }

  return { adapter: "pi", source: "default" };
}

export function getSelectedAdaptersForInit(root: string, flagAdapter?: string | boolean): AdapterName[] {
  const explicit = parseAdapterList(flagAdapter);
  if (explicit.length > 0) return explicit;

  const config = readAosConfig(root);
  const fromConfig = getEnabledAdaptersFromConfig(config);
  if (fromConfig.length > 0) return fromConfig;

  const adapterConfig = readAdapterConfig(root);
  if (typeof adapterConfig?.platform === "string" && isValidAdapter(adapterConfig.platform)) {
    return [adapterConfig.platform];
  }

  return [];
}

export function getPlatformUrlFromConfig(root: string): string | null {
  const config = readAosConfig(root);
  if (!config?.platform?.enabled) return null;
  return typeof config.platform.url === "string" ? config.platform.url : null;
}

export const DEFAULT_INIT_MODELS: InitModels = {
  economy: "anthropic/claude-haiku-4-5",
  standard: "anthropic/claude-sonnet-4-6",
  premium: "anthropic/claude-opus-4-7",
};

export function getInitModels(root: string): InitModels {
  const config = readAosConfig(root);
  const models = config?.models ?? {};
  return {
    economy: typeof models.economy === "string" ? models.economy : DEFAULT_INIT_MODELS.economy,
    standard: typeof models.standard === "string" ? models.standard : DEFAULT_INIT_MODELS.standard,
    premium: typeof models.premium === "string" ? models.premium : DEFAULT_INIT_MODELS.premium,
  };
}

export function getInitEditor(root: string): string {
  const config = readAosConfig(root);
  return typeof config?.editor === "string" ? config.editor : "code";
}

export function getInitMemoryProvider(root: string): "expertise" | "mempalace" | "graphify" | null {
  const path = join(root, ".aos", "memory.yaml");
  if (!existsSync(path)) return null;

  try {
    const parsed = yaml.load(readFileSync(path, "utf-8"), { schema: yaml.JSON_SCHEMA }) as { provider?: unknown } | null;
    return parsed?.provider === "mempalace" ||
      parsed?.provider === "expertise" ||
      parsed?.provider === "graphify"
      ? parsed.provider
      : null;
  } catch {
    return null;
  }
}

export function listKnownAdapters(): readonly AdapterName[] {
  return ADAPTER_ALLOWLIST;
}

export function getRecommendedModelsForAdapter(adapter: AdapterName): InitModels {
  switch (adapter) {
    case "pi":
      return {
        economy: "anthropic/claude-haiku-4-5",
        standard: "anthropic/claude-sonnet-4-6",
        premium: "anthropic/claude-opus-4-7",
      };
    case "claude-code":
      return {
        economy: "claude-haiku-4-5",
        standard: "claude-sonnet-4-6",
        premium: "claude-opus-4-7",
      };
    case "codex":
      return {
        economy: "gpt-5.1-codex-mini",
        standard: "gpt-5.2-codex",
        premium: "gpt-5.2-codex",
      };
    case "gemini":
      return {
        economy: "gemini-2.5-flash-lite",
        standard: "gemini-2.5-flash",
        premium: "gemini-2.5-pro",
      };
    default:
      return DEFAULT_INIT_MODELS;
  }
}

export function buildAdapterDefaults(
  adapters: AdapterName[],
  options: { legacyPiModels?: Partial<InitModels> } = {},
): Partial<Record<AdapterName, AdapterModelDefaults>> {
  return Object.fromEntries(
    adapters.map((adapter) => {
      if (adapter === "pi") {
        const recommended = getRecommendedModelsForAdapter(adapter);
        return [
          adapter,
          {
            use_vendor_default_model: false,
            models: {
              economy: options.legacyPiModels?.economy ?? recommended.economy,
              standard: options.legacyPiModels?.standard ?? recommended.standard,
              premium: options.legacyPiModels?.premium ?? recommended.premium,
            },
          },
        ];
      }
      return [adapter, { use_vendor_default_model: true }];
    }),
  );
}

function normalizeModels(models?: Partial<InitModels> | null): Partial<Record<ModelTier, string>> | undefined {
  if (!models) return undefined;
  const normalized: Partial<Record<ModelTier, string>> = {};
  if (typeof models.economy === "string" && models.economy.trim()) normalized.economy = models.economy;
  if (typeof models.standard === "string" && models.standard.trim()) normalized.standard = models.standard;
  if (typeof models.premium === "string" && models.premium.trim()) normalized.premium = models.premium;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function getRuntimeAdapterModelConfig(root: string, adapter: AdapterName): RuntimeAdapterModelConfig {
  const config = readAosConfig(root);
  if (config && isAosConfigV2(config)) {
    const adapterSettings = config.adapter_defaults?.[adapter];
    if (adapterSettings) {
      const modelOverrides = normalizeModels(adapterSettings.models);
      return {
        useVendorDefaultModel: adapterSettings.use_vendor_default_model ?? (adapter !== "pi" && !modelOverrides),
        modelOverrides,
        source: "config-v2",
      };
    }

    // Legacy v2 top-level `models` was originally written by `aos init`
    // without adapter scoping. Only honor it for Pi, where those IDs were
    // historically valid.
    if (adapter === "pi") {
      const modelOverrides = normalizeModels(config.models);
      if (modelOverrides) {
        return {
          useVendorDefaultModel: false,
          modelOverrides,
          source: "config-v1-pi-models",
        };
      }
    }
  }

  const adapterConfig = readAdapterConfig(root);
  if (adapterConfig && typeof adapterConfig.platform === "string" && adapterConfig.platform === adapter) {
    const modelOverrides = normalizeModels(adapterConfig.model_overrides as Partial<InitModels> | undefined);
    return {
      useVendorDefaultModel: adapterConfig.use_vendor_default_model ?? (adapter !== "pi" && !modelOverrides),
      modelOverrides,
      source: "adapter-yaml",
    };
  }

  return {
    useVendorDefaultModel: adapter !== "pi",
    source: "default",
  };
}
