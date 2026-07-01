// Bug 5: the arbiter bridge socket path must stay under the OS sun_path cap
// (104 bytes on macOS) even for long profile ids on a deep $TMPDIR.
import { test, expect, describe } from "bun:test";
import { bridgeSocketPath } from "../cli/src/bridge-server";

// The longest real profile id → longest session id.
const LONG_SESSION = "2026-07-01-architecture-review-mr1k0uaj";

describe("bridgeSocketPath", () => {
  test("stays under the unix socket path cap for a long profile id on a deep TMPDIR", () => {
    // A representative deep macOS $TMPDIR.
    const deepTmp = "/var/folders/9h/8xk_2j9d5v3fgh_qp0000gn/T";
    const p = bridgeSocketPath(LONG_SESSION, deepTmp);
    expect(Buffer.byteLength(p)).toBeLessThanOrEqual(104);
    expect(p.endsWith(".sock")).toBe(true);
  });

  test("is deterministic for the same session id", () => {
    expect(bridgeSocketPath(LONG_SESSION, "/tmp")).toBe(bridgeSocketPath(LONG_SESSION, "/tmp"));
  });

  test("is distinct for different session ids", () => {
    const a = bridgeSocketPath("2026-07-01-strategic-council-aaaaaaa", "/tmp");
    const b = bridgeSocketPath("2026-07-01-strategic-council-bbbbbbb", "/tmp");
    expect(a).not.toBe(b);
  });

  test("falls back to /tmp when the given dir would overflow the cap", () => {
    // A pathologically deep dir (>75 chars) forces the fallback.
    const overlyDeep = "/var/folders/" + "z".repeat(90) + "/T";
    const p = bridgeSocketPath(LONG_SESSION, overlyDeep);
    expect(p.startsWith("/tmp/")).toBe(true);
    expect(Buffer.byteLength(p)).toBeLessThanOrEqual(104);
  });

  test("uses the default TMPDIR and produces a short, bounded path", () => {
    const p = bridgeSocketPath(LONG_SESSION);
    expect(Buffer.byteLength(p)).toBeLessThanOrEqual(104);
    expect(p.endsWith(".sock")).toBe(true);
  });
});
