#!/usr/bin/env node
// Zero-dependency MCP (Model Context Protocol) stdio server: exposes Canva Magic Layers as
// agent tools. Speaks JSON-RPC 2.0 over stdin/stdout (newline-delimited) so any MCP client —
// Claude Code, Codex, Hermes, OpenClaw — can call decompose/harvest/status/login directly.
// stdout is the protocol channel: ALL diagnostics go to stderr only. See README "Give it to
// your agent". No SDK, no deps: the whole protocol is initialize -> tools/list -> tools/call.
const PROTOCOL = "2025-06-18";
// Versions whose initialize/tools/list/tools/call/ping surface this server implements verbatim.
// Echo the client's version when it's one of these, else answer with PROTOCOL — the spec forbids
// claiming a version we don't support, so we never echo an unknown/garbage string back.
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION = require("./package.json").version;

// name -> { description, schema, run(args, deps), long? }. `long` tools run the async AI job
// (~1-2 min); they get a progress heartbeat so the client's tool-call timeout doesn't fire.
const TOOLS = {
  decompose: {
    description: "Canva Magic Layers: flat image -> save every editable layer as a transparent PNG (plus document.json + manifest.json) into outDir. Hands-off after a one-time login. Needs a reasonably high-res PNG/JPG; takes ~1-2 min and uses the account's AI allowance.",
    schema: { type: "object", properties: { image: { type: "string", description: "Path to the source image (PNG/JPG)." }, outDir: { type: "string", description: "Output directory (default out/<name>)." } }, required: ["image"] },
    run: (a, d) => d.decompose(a.image, a.outDir), long: true,
  },
  harvest: {
    description: "Save every layer from a Canva design ALREADY split by Magic Layers — pass its URL or id. For an un-split image use decompose instead.",
    schema: { type: "object", properties: { design: { type: "string", description: "Canva design URL or id." }, outDir: { type: "string", description: "Output directory (default out/<id>)." } }, required: ["design"] },
    run: (a, d) => d.harvest(a.design, a.outDir), long: true,
  },
  status: {
    description: "Check whether the saved Canva session is signed in. Returns { signedIn }. Call before decompose/harvest.",
    schema: { type: "object", properties: {} },
    run: async (a, d) => ({ signedIn: await d.status() }),
  },
  login: {
    description: "Open Chrome for a human to sign in to Canva — the one manual step an agent cannot do itself. Blocks up to 5 min waiting for sign-in, then returns { signedIn }.",
    schema: { type: "object", properties: {} },
    run: async (a, d) => ({ signedIn: await d.login() }),
  },
};

const toolList = () => Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema }));
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (s, isError) => ({ content: [{ type: "text", text: s }], ...(isError ? { isError: true } : {}) });

// Route one JSON-RPC message. Returns the response object, or null for notifications (no id).
// Protocol problems (unknown method/tool, missing args) are JSON-RPC errors; a tool that RUNS
// and fails is a tools/call result with isError:true carrying Canva's own message verbatim
// (e.g. "Not signed in…" or "too small"). params/arguments are coerced from null so a
// non-conforming client can't throw us into a -32603. (`={}` defaults only cover undefined.)
async function handle(msg, deps) {
  const id = msg.id, method = msg.method;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  if (id === undefined) return null; // notification (e.g. notifications/initialized) — no reply
  if (method === "initialize") return ok(id, { protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "canva-magic-layers", version: VERSION } });
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: toolList() });
  if (method === "tools/call") {
    const t = TOOLS[params.name];
    if (!t) return rpcErr(id, -32602, "Unknown tool: " + params.name);
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
    const missing = (t.schema.required || []).find((k) => args[k] === undefined);
    if (missing) return rpcErr(id, -32602, "Missing required argument: " + missing);
    try { return ok(id, text(JSON.stringify(await t.run(args, deps)))); }
    catch (e) { return ok(id, text("✗ " + e.message, true)); }
  }
  return rpcErr(id, -32601, "Method not found: " + method);
}

// Periodic progress notification so a long AI job doesn't trip the client's tool-call timeout.
// Only fires when the client opted in with a progressToken; a no-op (null) otherwise.
function heartbeat(msg, send) {
  const tok = msg.method === "tools/call" && TOOLS[msg.params?.name]?.long && msg.params?._meta?.progressToken;
  if (!tok) return null;
  let p = 0;
  return setInterval(() => send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: tok, progress: ++p, message: "Running Magic Layers…" } }), 15000);
}

// Wire stdin -> handle -> stdout. Messages are newline-delimited JSON (MCP stdio framing).
// io is injectable for tests; defaults to the real process streams.
function serve(deps = require("./canva"), io = process) {
  const send = (o) => io.stdout.write(JSON.stringify(o) + "\n");
  let buf = "", inflight = 0, ending = false;
  const maybeExit = () => { if (ending && inflight === 0) process.exit(0); };
  io.stdin.setEncoding("utf8");
  io.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue; // ignore non-objects + (removed) batches
      inflight++;
      const beat = heartbeat(msg, send);
      handle(msg, deps)
        .then((res) => { if (res) send(res); })
        .catch((e) => { if (msg.id !== undefined) send(rpcErr(msg.id, -32603, e.message)); })
        .finally(() => { clearInterval(beat); inflight--; maybeExit(); });
    }
  });
  // stdio shutdown = the client closes our stdin. Drain in-flight tool calls first so a long
  // (paid) AI job mid-flight still gets to save its layers before we exit.
  io.stdin.on("end", () => { ending = true; maybeExit(); });
  process.stderr.write(`canva-magic-layers MCP server ready (protocol ${PROTOCOL}).\n`);
}

module.exports = { serve, handle, heartbeat, toolList, TOOLS, PROTOCOL };
if (require.main === module) serve();
