import type { AdapterName } from "./utils";

export type PackageManager = "bun" | "npm" | "unknown";
export type AuthState = "ready" | "needs-login" | "unknown";
export type AdapterStatus =
  | "ready"
  | "needs-adapter"
  | "needs-cli"
  | "needs-login"
  | "broken";

export interface VendorCliReadiness {
  present: boolean;
  version?: string;
  path?: string;
  auth: {
    state: AuthState;
    hint?: string;
  };
}

export interface AosAdapterReadiness {
  installed: boolean;
  version?: string;
  store?: "bun" | "npm" | "project-local" | "workspace" | "unknown";
  loadable: boolean;
  resolvedFrom?: string;
}

export interface AdapterReadiness {
  adapter: AdapterName;
  vendorCli: VendorCliReadiness;
  aosAdapter: AosAdapterReadiness;
  status: AdapterStatus;
  statusHint: string;
  info?: Record<string, string>;
}

export interface MemoryBackendScan {
  available: boolean;
  socketPath: string;
  binaryInstalled: boolean;
  binaryPath?: string;
}

export interface ScanReport {
  packageManager: PackageManager;
  adapters: Record<AdapterName, AdapterReadiness>;
  memory: {
    mempalace: MemoryBackendScan;
    graphify: MemoryBackendScan;
  };
  notes: string[];
}

export interface InitModels {
  economy: string;
  standard: string;
  premium: string;
}

export interface AdapterModelDefaults {
  use_vendor_default_model: boolean;
  models?: Partial<InitModels>;
}

export interface WizardAction {
  type: "install-adapter" | "info-login" | "info-install-vendor-cli";
  packageName?: string;
  manager?: "bun" | "npm";
  global?: true;
  adapter?: AdapterName;
  vendorCommand?: string;
  url?: string;
}

export interface WizardResult {
  enabledAdapters: AdapterName[];
  defaultAdapter: AdapterName;
  memory: {
    provider: "expertise" | "mempalace" | "graphify";
  };
  models: InitModels;
  adapterDefaults: Partial<Record<AdapterName, AdapterModelDefaults>>;
  editor: string;
  actions: WizardAction[];
}
