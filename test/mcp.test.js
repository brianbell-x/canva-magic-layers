// In-process tests of the MCP server's pure router handle(msg, deps) and the heartbeat.
// No stdio, no Chrome, no network: deps are stubs, so an unexpected dispatch is observable.
const { test, mock } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { handle, serve, toolList, heartbeat, TOOLS, PROTOCOL } = require("../mcp");
const VERSION = require("../package.json").version;

// A spy that records its args and resolves to a configurable value (or throws if value is Error).
function spy(value) {
  const fn = async (...args) => { fn.calls.push(args); if (value instanceof Error) throw value; return typeof value === "function" ? value(...args) : value; };
  fn.calls = [];
  return fn;
}
const allDeps = (over = {}) => Object.assign({ decompose: spy({ designId: "DX", count: 3, outDir: "out/x" }), harvest: spy({ designId: "DH", count: 9, outDir: "out/DH" }), status: spy(true), login: spy(true) }, over);
const call = (name, args, deps) => handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, deps);

// --- initialize / ping handshake --------------------------------------------
test("initialize echoes a SUPPORTED requested version and advertises the tools capability", async () => {
  const r = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, allDeps());
  assert.strictEqual(r.result.protocolVersion, "2024-11-05", "a version we support is echoed");
  assert.deepStrictEqual(r.result.capabilities, { tools: {} });
  assert.strictEqual(r.result.serverInfo.name, "canva-magic-layers");
  assert.strictEqual(r.result.serverInfo.version, VERSION, "serverInfo.version tracks package.json");
});

test("initialize falls back to PROTOCOL for a missing/null/unsupported version (never echoes garbage)", async () => {
  for (const params of [{}, null, { protocolVersion: "1.0.0" }, { protocolVersion: "banana" }])
    assert.strictEqual((await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params }, allDeps())).result.protocolVersion, PROTOCOL, `params=${JSON.stringify(params)}`);
});

test("ping returns an empty result", async () => {
  assert.deepStrictEqual((await handle({ jsonrpc: "2.0", id: 7, method: "ping" }, allDeps())).result, {});
});

// --- tools/list contract -----------------------------------------------------
test("tools/list exposes decompose/harvest/status/login with name+description+inputSchema", async () => {
  const tools = (await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, allDeps())).result.tools;
  assert.deepStrictEqual(tools.map((t) => t.name).sort(), ["decompose", "harvest", "login", "status"]);
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 10, `${t.name} has a description`);
    assert.strictEqual(t.inputSchema.type, "object", `${t.name} inputSchema is an object`);
  }
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepStrictEqual(byName.decompose.inputSchema.required, ["image"], "decompose requires image");
  assert.deepStrictEqual(byName.harvest.inputSchema.required, ["design"], "harvest requires design");
});

// --- tools/call dispatch -----------------------------------------------------
for (const [name, args, depArgs, expected] of [
  ["decompose", { image: "p.png", outDir: "out/x" }, ["p.png", "out/x"], { designId: "DX", count: 3, outDir: "out/x" }],
  ["harvest", { design: "DH", outDir: "out/DH" }, ["DH", "out/DH"], { designId: "DH", count: 9, outDir: "out/DH" }],
]) {
  test(`tools/call ${name} returns the result as JSON text and passes its args through`, async () => {
    const deps = allDeps();
    const r = await call(name, args, deps);
    assert.ok(!r.result.isError, "success is not flagged isError");
    assert.deepStrictEqual(JSON.parse(r.result.content[0].text), expected, "content text is the result as JSON");
    assert.deepStrictEqual(deps[name].calls, [depArgs], `${name} called with the mapped positional args`);
  });
}

test("tools/call status wraps the boolean as { signedIn }", async () => {
  const r = await call("status", {}, allDeps({ status: spy(false) }));
  assert.deepStrictEqual(JSON.parse(r.result.content[0].text), { signedIn: false });
});

test("a tool that throws is returned as an isError result carrying the message verbatim (not a protocol error)", async () => {
  const r = await call("decompose", { image: "p.png" }, allDeps({ decompose: spy(new Error("Not signed in to Canva")) }));
  assert.strictEqual(r.result.isError, true);
  assert.ok(r.result.content[0].text.includes("Not signed in to Canva"));
  assert.strictEqual(r.error, undefined, "tool failure is not a JSON-RPC error");
});

test("tools/call for an unknown tool is a JSON-RPC -32602 protocol error (per the tools spec)", async () => {
  const r = await call("bogus", {}, allDeps());
  assert.strictEqual(r.error.code, -32602);
  assert.ok(r.error.message.includes("bogus"));
  assert.strictEqual(r.result, undefined, "unknown tool is a protocol error, not a result");
});

test("tools/call missing a required argument is a -32602 error and does NOT invoke the tool", async () => {
  const deps = allDeps();
  const r = await call("decompose", {}, deps); // no `image`
  assert.strictEqual(r.error.code, -32602);
  assert.ok(/image/.test(r.error.message), "names the missing argument");
  assert.strictEqual(deps.decompose.calls.length, 0, "the tool is never called with bad input");
});

// --- notifications & unknown methods ----------------------------------------
test("a notification (no id) yields no response", async () => {
  assert.strictEqual(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, allDeps()), null);
});

test("an unknown method returns JSON-RPC -32601 Method not found", async () => {
  const r = await handle({ jsonrpc: "2.0", id: 5, method: "resources/list" }, allDeps());
  assert.strictEqual(r.error.code, -32601);
  assert.ok(r.error.message.includes("resources/list"));
});

// --- progress heartbeat ------------------------------------------------------
test("heartbeat is a no-op (null) without a progressToken, and only arms for long tools", () => {
  assert.strictEqual(heartbeat({ method: "tools/call", params: { name: "decompose" } }, () => {}), null, "no token -> no heartbeat");
  assert.strictEqual(heartbeat({ method: "tools/call", params: { name: "status", _meta: { progressToken: 1 } } }, () => {}), null, "status is not long -> no heartbeat");
});

test("heartbeat emits a notifications/progress carrying the request's progressToken on each tick", () => {
  assert.ok(TOOLS.decompose.long, "decompose is marked long (heartbeat-eligible)");
  mock.timers.enable({ apis: ["setInterval"] });
  const sent = [];
  const beat = heartbeat({ method: "tools/call", params: { name: "decompose", _meta: { progressToken: "tok" } } }, (o) => sent.push(o));
  try {
    mock.timers.tick(15000);
    assert.deepStrictEqual(sent[0], { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "tok", progress: 1, message: "Running Magic Layers…" } });
    mock.timers.tick(15000);
    assert.strictEqual(sent[1].params.progress, 2, "progress increments per tick");
  } finally { clearInterval(beat); mock.timers.reset(); }
});

// --- serve(): the wire layer (stdio framing, junk-skipping, crash-safety) ----
// Fake stdin (an EventEmitter) + a capturing stdout, so the real transport runs without a
// process. We never emit "end", so the drain-and-exit path doesn't terminate the test runner.
function fakeServe(deps) {
  const stdin = new EventEmitter();
  stdin.setEncoding = () => {};
  const out = [];
  serve(deps, { stdin, stdout: { write: (s) => out.push(s) } });
  return { feed: (s) => stdin.emit("data", s), ids: () => out.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l).id) };
}
const flush = () => new Promise((r) => setImmediate(r));

test("serve frames newline-delimited JSON within one chunk and answers each request", async () => {
  const s = fakeServe(allDeps());
  s.feed('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  await flush();
  assert.deepStrictEqual(s.ids(), [1, 2], "both framed messages dispatched");
});

test("serve reassembles a request split across two chunks", async () => {
  const s = fakeServe(allDeps());
  s.feed('{"jsonrpc":"2.0","id":5,"meth');
  s.feed('od":"ping"}\n');
  await flush();
  assert.deepStrictEqual(s.ids(), [5]);
});

test("serve skips blank, unparseable, and bare-`null` lines without crashing", async () => {
  const s = fakeServe(allDeps());
  s.feed("\n");          // blank
  s.feed("not json\n");  // unparseable
  s.feed("null\n");      // valid JSON but not an object — used to crash the server
  s.feed("[1,2]\n");     // JSON array (batching is removed in 2025-06-18) — ignored
  s.feed('{"jsonrpc":"2.0","id":9,"method":"ping"}\n');
  await flush();
  assert.deepStrictEqual(s.ids(), [9], "only the valid request is answered; all junk is ignored");
});
