import { ExpertiseProvider } from "./expertise-provider";
import { loadMemoryConfig } from "./memory-config";
import { McpClient } from "./mcp-client";
import { MemPalaceProvider } from "./mempalace-provider";
import { GraphifyProvider } from "./graphify-provider";
import type { MemoryProvider } from "./memory-provider";

export interface RuntimeMemoryProvider {
  provider: MemoryProvider;
  providerId: "expertise" | "mempalace" | "graphify";
  configuredProvider: "expertise" | "mempalace" | "graphify";
  shutdown: () => Promise<void>;
}

export interface CreateRuntimeMemoryProviderOptions {
  mempalaceCommand?: string;
  mempalaceArgs?: string[];
  graphifyCommand?: string;
  graphifyArgs?: string[];
  requireConfiguredProvider?: boolean;
  onWarning?: (message: string) => void;
}

export async function createRuntimeMemoryProvider(
  projectDir: string,
  opts: CreateRuntimeMemoryProviderOptions = {},
): Promise<RuntimeMemoryProvider> {
  const config = loadMemoryConfig(projectDir);

  if (config.provider === "mempalace") {
    const client = new McpClient(
      opts.mempalaceCommand ?? "python",
      opts.mempalaceArgs ?? ["-m", "mempalace.mcp_server"],
    );

    try {
      await client.start();
      return {
        provider: new MemPalaceProvider(client),
        providerId: "mempalace",
        configuredProvider: "mempalace",
        shutdown: () => client.stop(),
      };
    } catch (err) {
      await client.stop();
      const message = `MemPalace provider configured but unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`;
      if (opts.requireConfiguredProvider) {
        throw new Error(message);
      }
      opts.onWarning?.(`${message}. Falling back to built-in expertise memory.`);
    }
  }

  if (config.provider === "graphify") {
    const graphPath = config.graphify?.graphPath ?? "graphify-out/graph.json";
    const client = new McpClient(
      opts.graphifyCommand ?? config.graphify?.mcpCommand ?? "graphify-mcp",
      opts.graphifyArgs ?? [graphPath],
    );

    try {
      await client.start();
      const provider = new GraphifyProvider(client);
      await provider.initialize(config);
      return {
        provider,
        providerId: "graphify",
        configuredProvider: "graphify",
        shutdown: () => client.stop(),
      };
    } catch (err) {
      await client.stop();
      const message = `Graphify provider configured but unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`;
      if (opts.requireConfiguredProvider) {
        throw new Error(message);
      }
      opts.onWarning?.(
        `${message}. Build a graph with \`graphify build\`, then retry. Falling back to built-in expertise memory.`,
      );
    }
  }

  const provider = new ExpertiseProvider();
  return {
    provider,
    providerId: "expertise",
    configuredProvider: config.provider,
    shutdown: async () => {},
  };
}
