import { createServer, Socket } from "node:net";
import { unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_REQUEST_BYTES = 1024 * 1024;

// Unix domain socket paths are capped by the OS (sun_path is 104 bytes on
// macOS, 108 on Linux, including the NUL terminator). A deep macOS $TMPDIR
// (/var/folders/../T ≈ 48 chars) plus a long, human-readable session id
// (`<date>-<profile>-<rand>`, ~40 chars for `architecture-review`) overflows
// that cap and `listen()` fails. Keep this comfortably under the smaller cap.
const MAX_SOCKET_PATH_BYTES = 100;

/**
 * Build a short, collision-resistant Unix socket path for the arbiter bridge.
 *
 * The session id is hashed to a fixed 16-hex-char token so the file name is a
 * constant 25 bytes (`aos-<16hex>.sock`) regardless of how long the profile
 * name is — long profile ids like `architecture-review` no longer blow the
 * 104-byte sun_path limit. If the resolved `$TMPDIR` is itself deep enough to
 * overflow the cap, fall back to `/tmp` (short and world-writable) so the
 * bridge binds on any TMPDIR without the caller needing `TMPDIR=/tmp`.
 */
export function bridgeSocketPath(sessionId: string, dir: string = tmpdir()): string {
  const token = createHash("sha1").update(sessionId).digest("hex").slice(0, 16);
  const name = `aos-${token}.sock`;
  const full = join(dir, name);
  if (Buffer.byteLength(full) > MAX_SOCKET_PATH_BYTES && dir !== "/tmp") {
    return join("/tmp", name);
  }
  return full;
}
const METHODS = ["delegate", "end", "aos_recall", "aos_remember"] as const;
type BridgeMethod = typeof METHODS[number];

export interface BridgeHandlers {
  delegate: (params: { to: string | string[]; message: string }) => Promise<unknown>;
  end: (params: { closing_message: string }) => Promise<unknown>;
  aos_recall: (params: {
    query: string;
    agent?: string;
    hall?: string;
    max_results?: number;
  }) => Promise<unknown>;
  aos_remember: (params: {
    content: string;
    agent: string;
    hall?: string;
    source?: string;
  }) => Promise<unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseListenTarget(target: string): { host: string; port: number } | { path: string } {
  if (!target.startsWith("tcp://")) {
    return { path: target };
  }

  const url = new URL(target);
  const port = Number.parseInt(url.port, 10);
  if (!url.hostname || Number.isNaN(port)) {
    throw new Error(`Invalid bridge listen target: ${target}`);
  }

  // The bridge RPC exposes state-changing methods (delegate/aos_remember) with
  // NO authentication — safe only for local IPC. Refuse to bind a non-loopback
  // TCP interface, which would put those methods on the network unauthenticated
  // (CWE-306). Unix sockets (OS-permission scoped) and loopback TCP are allowed.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost" || /^127\./.test(host);
  if (!isLoopback) {
    throw new Error(
      `bridge server: refusing to bind non-loopback TCP host "${host}" — the bridge RPC is unauthenticated and must stay local (use a Unix socket or 127.0.0.1)`,
    );
  }

  return { host: url.hostname, port };
}

function validateString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid params: ${field} must be a non-empty string`);
  }
  return value;
}

function validateOptionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid params: ${field} must be a non-empty string when provided`);
  }
  return value;
}

function validateOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid params: ${field} must be a positive integer when provided`);
  }
  return value;
}

function validateRequest(raw: unknown): { id: unknown; method: BridgeMethod; params: Record<string, unknown> } {
  if (!isObject(raw)) throw new Error("invalid request: expected object");
  const method = raw.method;
  if (typeof method !== "string" || !METHODS.includes(method as BridgeMethod)) {
    throw new Error(`unknown method: ${String(method)}`);
  }
  const params = raw.params == null ? {} : raw.params;
  if (!isObject(params)) throw new Error("invalid request: params must be an object");

  switch (method as BridgeMethod) {
    case "delegate": {
      const to = params.to;
      const validTarget = typeof to === "string" && to.trim() !== ""
        || Array.isArray(to) && to.length > 0 && to.every((item) => typeof item === "string" && item.trim() !== "");
      if (!validTarget) throw new Error("invalid params: to must be a non-empty string or string array");
      validateString(params.message, "message");
      break;
    }
    case "end":
      validateString(params.closing_message, "closing_message");
      break;
    case "aos_recall":
      validateString(params.query, "query");
      validateOptionalString(params.agent, "agent");
      validateOptionalString(params.hall, "hall");
      validateOptionalPositiveInteger(params.max_results, "max_results");
      break;
    case "aos_remember":
      validateString(params.content, "content");
      validateString(params.agent, "agent");
      validateOptionalString(params.hall, "hall");
      validateOptionalString(params.source, "source");
      break;
  }

  return { id: raw.id, method: method as BridgeMethod, params };
}

export async function startBridgeServer(
  socketPath: string,
  handlers: BridgeHandlers,
): Promise<() => Promise<void>> {
  const listenTarget = parseListenTarget(socketPath);
  const isUnixSocket = "path" in listenTarget;

  if (isUnixSocket && existsSync(listenTarget.path)) unlinkSync(listenTarget.path);

  const open = new Set<Socket>();

  const server = createServer((sock: Socket) => {
    open.add(sock);
    sock.on("close", () => open.delete(sock));
    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk.toString("utf-8");
      if (buf.length > MAX_REQUEST_BYTES) {
        sock.write(JSON.stringify({ id: null, error: `request too large: max ${MAX_REQUEST_BYTES} bytes` }) + "\n");
        sock.destroy();
        return;
      }
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req: any;
        try {
          req = validateRequest(JSON.parse(line));
          let result: unknown;
          if (req.method === "delegate") result = await handlers.delegate(req.params);
          else if (req.method === "end") result = await handlers.end(req.params);
          else if (req.method === "aos_recall") result = await handlers.aos_recall(req.params);
          else if (req.method === "aos_remember") result = await handlers.aos_remember(req.params);
          sock.write(JSON.stringify({ id: req.id, result }) + "\n");
        } catch (err: any) {
          sock.write(JSON.stringify({ id: req?.id ?? null, error: String(err?.message ?? err) }) + "\n");
        }
      }
    });
    sock.on("error", () => { /* client disconnect is fine */ });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    if ("path" in listenTarget) {
      server.listen(listenTarget.path, () => resolve());
      return;
    }
    server.listen(listenTarget.port, listenTarget.host, () => resolve());
  });

  return async () => {
    for (const s of open) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (isUnixSocket && existsSync(listenTarget.path)) unlinkSync(listenTarget.path);
  };
}
