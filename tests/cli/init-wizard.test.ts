import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWizard } from "../../cli/src/init-wizard";
import type { PromptContext } from "../../cli/src/prompts";
import type { ScanReport } from "../../cli/src/init-types";

const scan: ScanReport = {
  packageManager: "bun",
  adapters: {
    pi: {
      adapter: "pi",
      vendorCli: { present: true, path: "/usr/bin/pi", auth: { state: "ready" } },
      aosAdapter: { installed: true, loadable: true, store: "bun", resolvedFrom: "/pkg/pi" },
      status: "ready",
      statusHint: "Pi CLI and AOS adapter are ready.",
    },
    "claude-code": {
      adapter: "claude-code",
      vendorCli: { present: true, path: "/usr/bin/claude", auth: { state: "needs-login", hint: "Run `claude login`" } },
      aosAdapter: { installed: false, loadable: false, store: "unknown" },
      status: "needs-login",
      statusHint: "Run `claude login`",
    },
    codex: {
      adapter: "codex",
      vendorCli: { present: true, path: "/usr/bin/codex", auth: { state: "ready" } },
      aosAdapter: { installed: false, loadable: false, store: "unknown" },
      status: "needs-adapter",
      statusHint: "Install @aos-harness/codex-adapter to let AOS use the Codex CLI.",
    },
    gemini: {
      adapter: "gemini",
      vendorCli: { present: false, auth: { state: "unknown", hint: "Install Gemini CLI" } },
      aosAdapter: { installed: false, loadable: false, store: "unknown" },
      status: "needs-cli",
      statusHint: "Install the Gemini CLI first.",
    },
  },
  memory: {
    mempalace: {
      available: false,
      socketPath: "/tmp/mempalace.sock",
      binaryInstalled: false,
    },
    graphify: {
      available: false,
      socketPath: "",
      binaryInstalled: false,
    },
  },
  notes: [],
};

function mockPromptContext(): PromptContext {
  return {
    intro() {},
    outro() {},
    note() {},
    cancel() {},
    isCancel: () => false,
    async confirm() {
      return true;
    },
    async select(opts) {
      return opts.initialValue ?? opts.options[0]!.value;
    },
    async multiselect(opts) {
      return opts.initialValues ?? [opts.options[0]!.value];
    },
  };
}

describe("init-wizard", () => {
  test("builds actions from readiness matrix", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-init-wizard-"));
    const result = await runWizard(scan, root, undefined, mockPromptContext());
    expect(result).not.toBeNull();
    if (!result) {
      throw new Error("Expected wizard result");
    }
    expect(result.enabledAdapters).toEqual(["pi", "claude-code", "codex"]);
    expect(result.defaultAdapter).toBe("pi");
    expect(result.memory.provider).toBe("expertise");
    expect(result.adapterDefaults.pi?.use_vendor_default_model).toBe(false);
    expect(result.adapterDefaults.codex?.use_vendor_default_model).toBe(true);
    expect(result.actions.some((action) => action.type === "install-adapter" && action.packageName === "@aos-harness/codex-adapter")).toBe(true);
    expect(result.actions.some((action) => action.type === "info-login" && action.adapter === "claude-code")).toBe(true);
  });

  test("returns null when final confirmation is declined", async () => {
    const promptContext = mockPromptContext();
    promptContext.confirm = async () => false;

    const result = await runWizard(scan, process.cwd(), undefined, promptContext);
    expect(result).toBeNull();
  });

  test("re-entry skips selection prompts when existing config already matches the recommended state", async () => {
    const root = mkdtempSync(join(tmpdir(), "aos-init-wizard-"));
    mkdirSync(join(root, ".aos"), { recursive: true });
    writeFileSync(
      join(root, ".aos", "config.yaml"),
      `api_version: aos/config/v2
adapters:
  enabled: [pi, claude-code, codex]
  default: pi
models:
  economy: anthropic/claude-haiku-4-5
  standard: anthropic/claude-sonnet-4-6
  premium: anthropic/claude-opus-4-6
editor: code
`,
    );
    writeFileSync(
      join(root, ".aos", "memory.yaml"),
      `api_version: aos/memory/v1
provider: expertise
`,
    );

    let multiselectCalls = 0;
    let selectCalls = 0;
    let confirmCalls = 0;
    const promptContext = mockPromptContext();
    promptContext.multiselect = async (opts) => {
      multiselectCalls += 1;
      return opts.initialValues ?? [];
    };
    promptContext.select = async (opts) => {
      selectCalls += 1;
      return opts.initialValue ?? opts.options[0]!.value;
    };
    promptContext.confirm = async () => {
      confirmCalls += 1;
      return true;
    };

    const rerunScan: ScanReport = {
      ...scan,
      adapters: {
        ...scan.adapters,
        "claude-code": {
          ...scan.adapters["claude-code"],
          status: "ready",
          statusHint: "Claude Code CLI and AOS adapter are ready.",
          aosAdapter: { installed: true, loadable: true, store: "bun", resolvedFrom: "/pkg/claude" },
          vendorCli: { present: true, path: "/usr/bin/claude", auth: { state: "ready" } },
        },
      },
    };

    const result = await runWizard(rerunScan, root, undefined, promptContext);
    expect(result?.enabledAdapters).toEqual(["pi", "claude-code", "codex"]);
    expect(result?.defaultAdapter).toBe("pi");
    expect(result?.memory.provider).toBe("expertise");
    expect(multiselectCalls).toBe(0);
    expect(selectCalls).toBe(0);
    expect(confirmCalls).toBe(1);
  });
});
