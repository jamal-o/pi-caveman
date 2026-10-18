/**
 * Regression: syncStatus must not throw when the host exposes setStatus
 * without a TUI theme (e.g. pi-web-ui, whose wrapper spread drops the
 * prototype `theme` getter). Previously `theme.fg` threw:
 *   TypeError: Cannot read properties of undefined (reading 'fg')
 * on session_start / agent_start / agent_end.
 *
 *   node scripts/test-status-no-theme.mjs
 */
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Set before importing: the extension resolves CONFIG_PATH at module load.
const configDir = mkdtempSync(join(tmpdir(), "pi-caveman-status-test-"));
process.env.PI_CODING_AGENT_DIR = configDir;
process.on("exit", () => rmSync(configDir, { recursive: true, force: true }));

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const handlers = new Map();
let commandHandler = null;

const stub = {
  on(event, handler) {
    handlers.set(event, handler);
  },
  registerCommand(name, opts) {
    if (name === "caveman") commandHandler = opts.handler;
  },
  appendEntry() {},
};

const mod = await import(pathToFileURL(join(root, "extensions/caveman.ts")).href);
mod.default(stub);

if (!commandHandler) {
  console.error("FAIL: /caveman command not registered");
  process.exit(1);
}

// Host with setStatus but NO theme — the pi-web-ui shape.
const statusWrites = [];
const ctx = {
  ui: { setStatus: (key, text) => statusWrites.push({ key, text }), notify() {} },
  sessionManager: { getEntries: () => [] },
  hasUI: true,
};

await commandHandler("full", ctx);

for (const event of ["session_start", "agent_start", "agent_end"]) {
  const handler = handlers.get(event);
  if (typeof handler !== "function") {
    console.error(`FAIL: ${event} handler missing`);
    process.exit(1);
  }
  await handler(event === "session_start" ? { reason: "test" } : {}, ctx);
}

if (statusWrites.length !== 0) {
  console.error("FAIL: expected no status writes without a theme", statusWrites);
  process.exit(1);
}

// Sanity: with a theme present the status still renders.
const themedWrites = [];
const themedCtx = {
  ui: {
    setStatus: (key, text) => themedWrites.push({ key, text }),
    notify() {},
    theme: { fg: (_c, s) => s, bold: (s) => s },
  },
  sessionManager: { getEntries: () => [] },
  hasUI: true,
};

await handlers.get("agent_start")({}, themedCtx);
if (!themedWrites.some((w) => w.key === "caveman" && /caveman level:/.test(w.text))) {
  console.error("FAIL: themed status did not render", themedWrites);
  process.exit(1);
}

await handlers.get("session_shutdown")();

console.log("PASS: status stays silent without a theme, renders with one");
