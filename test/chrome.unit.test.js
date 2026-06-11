// Offline unit coverage of chrome.js seams. No real Chrome, no network.
// Node built-ins only. Run: node --test
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildArgs, findChrome, CDP, readPort, makePage, evaluate } = require("../scripts/chrome");

// ---------- buildArgs ----------

test("buildArgs always includes the mandatory launch flags (#1, #7)", () => {
  const a = buildArgs("C:/prof", {});
  assert.ok(a.includes("--remote-debugging-port=0"));
  assert.ok(a.includes("--remote-allow-origins=*"));
  assert.ok(a.includes("--disable-blink-features=AutomationControlled"));
  assert.ok(a.includes("--user-data-dir=C:/prof"));
  assert.ok(a.includes("--no-first-run"));
  assert.ok(a.includes("--no-default-browser-check"));
});

test("buildArgs default startUrl is about:blank and is last", () => {
  assert.equal(buildArgs("p", {}).at(-1), "about:blank");
  assert.equal(buildArgs("p", { startUrl: "https://x" }).at(-1), "https://x");
});

test("buildArgs headless adds --headless=new + gpu/window-size and NOT offscreen", () => {
  const a = buildArgs("p", { headless: true });
  assert.ok(a.includes("--headless=new"));
  assert.ok(a.includes("--disable-gpu"));
  assert.ok(a.includes("--window-size=1600,1000"));
  assert.ok(!a.includes("--window-position=-32000,-32000"));
});

test("buildArgs offscreen adds --window-position=-32000,-32000; headless takes precedence (#3, #4)", () => {
  const a = buildArgs("p", { offscreen: true });
  assert.ok(a.includes("--window-position=-32000,-32000"));
  assert.ok(a.includes("--window-size=1280,900"));
  const b = buildArgs("p", { headless: true, offscreen: true });
  assert.ok(b.includes("--headless=new"));
  assert.ok(!b.includes("--window-position=-32000,-32000"));
});

// The visible (login) launch — neither headless nor offscreen — must force an ON-SCREEN
// window, overriding the off-screen bounds the offscreen runs persist into the shared profile.
test("buildArgs visible login launch positions the window on-screen (not the offscreen -32000)", () => {
  const a = buildArgs("p", { startUrl: "https://www.canva.com/login" });
  assert.ok(a.includes("--window-position=80,60"), "on-screen position");
  assert.ok(a.includes("--window-size=1200,900"), "explicit size (position alone leaves saved size)");
  assert.ok(!a.includes("--window-position=-32000,-32000"), "must not inherit the offscreen position");
  assert.equal(a.at(-1), "https://www.canva.com/login", "startUrl stays last");
});

// ---------- findChrome ----------

test("findChrome: env override, platform candidate, and throw", async (t) => {
  const realExists = fs.existsSync;
  const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const env = process.env;
  const savedChrome = env.CANVA_CHROME, savedPF = env.PROGRAMFILES;

  t.after(() => {
    fs.existsSync = realExists;
    Object.defineProperty(process, "platform", realPlatform);
    if (savedChrome === undefined) delete env.CANVA_CHROME; else env.CANVA_CHROME = savedChrome;
    if (savedPF === undefined) delete env.PROGRAMFILES; else env.PROGRAMFILES = savedPF;
  });

  await t.test("returns CANVA_CHROME when it exists", () => {
    fs.existsSync = (p) => p === "C:/fake/chrome.exe";
    env.CANVA_CHROME = "C:/fake/chrome.exe";
    assert.equal(findChrome(), "C:/fake/chrome.exe");
  });

  await t.test("picks a platform candidate when CANVA_CHROME unset", () => {
    delete env.CANVA_CHROME;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    env.PROGRAMFILES = "C:/PF";
    fs.existsSync = (p) => typeof p === "string" && p.includes("chrome.exe") && p.includes("C:/PF");
    assert.equal(findChrome(), "C:/PF\\Google\\Chrome\\Application\\chrome.exe");
  });

  await t.test("throws when no binary exists", () => {
    delete env.CANVA_CHROME;
    fs.existsSync = () => false;
    assert.throws(findChrome, /No Chrome\/Edge\/Brave found/);
  });
});

// ---------- readPort ----------

test("readPort returns first trimmed line once the file appears (#8)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canva-port-"));
  try {
    fs.writeFileSync(path.join(tmp, "DevToolsActivePort"), "54321\n/devtools/browser/abc");
    assert.equal(await readPort(tmp, 1000), "54321");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("readPort throws after timeout when file never appears", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canva-noport-"));
  try {
    await assert.rejects(readPort(tmp, 300), /did not expose a debugging port/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- CDP id-correlation ----------

test("CDP.send increments id and sends JSON with method/params and optional sessionId", () => {
  const sent = [];
  const fakeWs = { send: (s) => sent.push(JSON.parse(s)), onmessage: null };
  const cdp = new CDP(fakeWs);
  cdp.send("M1", { a: 1 });
  cdp.send("M2", { b: 2 }, "sid");
  assert.deepEqual(sent[0], { id: 1, method: "M1", params: { a: 1 } });
  assert.ok(!("sessionId" in sent[0]));
  assert.deepEqual(sent[1], { id: 2, method: "M2", params: { b: 2 }, sessionId: "sid" });
});

test("CDP resolves the matching pending promise on a result frame", async () => {
  const fakeWs = { send: () => {}, onmessage: null };
  const cdp = new CDP(fakeWs);
  const p = cdp.send("M");
  fakeWs.onmessage({ data: JSON.stringify({ id: 1, result: { ok: true } }) });
  assert.deepEqual(await p, { ok: true });
  assert.equal(cdp.pending.size, 0);
});

test("CDP rejects with error.message on an error frame", async () => {
  const fakeWs = { send: () => {}, onmessage: null };
  const cdp = new CDP(fakeWs);
  const p = cdp.send("M");
  fakeWs.onmessage({ data: JSON.stringify({ id: 1, error: { message: "boom" } }) });
  await assert.rejects(p, /boom/);
});

test("CDP ignores event frames (no id) and non-JSON frames (correlation guard)", () => {
  const fakeWs = { send: () => {}, onmessage: null };
  const cdp = new CDP(fakeWs);
  cdp.send("M");
  fakeWs.onmessage({ data: "not json" });
  fakeWs.onmessage({ data: JSON.stringify({ method: "Some.event", params: {} }) });
  assert.equal(cdp.pending.size, 1);
});

test("CDP constructor initializes id 0, empty pending, and assigns onmessage", () => {
  const fakeWs = { send: () => {}, onmessage: null };
  const cdp = new CDP(fakeWs);
  assert.equal(cdp.id, 0);
  assert.ok(cdp.pending instanceof Map && cdp.pending.size === 0);
  assert.equal(typeof fakeWs.onmessage, "function");
});

// ---------- evaluate ----------

test("evaluate returns result.value on success and sends awaitPromise/returnByValue true (#6)", async () => {
  let captured;
  const fakeCdp = { send: async (m, p, sid) => { captured = { m, p, sid }; return { result: { value: 42 } }; } };
  assert.equal(await evaluate(fakeCdp, "sid", "1+1"), 42);
  assert.equal(captured.m, "Runtime.evaluate");
  assert.equal(captured.p.expression, "1+1");
  assert.equal(captured.p.awaitPromise, true);
  assert.equal(captured.p.returnByValue, true);
  assert.equal(captured.sid, "sid");
});

test("evaluate throws exceptionDetails.exception.description then falls back to .text", async () => {
  const desc = { send: async () => ({ exceptionDetails: { exception: { description: "TypeError x" } } }) };
  await assert.rejects(evaluate(desc, "sid", "x"), /TypeError x/);
  const txt = { send: async () => ({ exceptionDetails: { text: "parse fail" } }) };
  await assert.rejects(evaluate(txt, "sid", "x"), /parse fail/);
});

// ---------- makePage generated page JS ----------

// Fake cdp routing by method; Runtime.evaluate handler captures expressions.
function fakeCdpFor(handlers, capture) {
  return {
    send: async (method, params = {}, sid) => {
      if (method === "Runtime.evaluate" && capture) capture.push(params.expression);
      const h = handlers[method];
      if (h) return h(params, sid);
      if (method === "Target.attachToTarget") return { sessionId: "sess-1" };
      return {};
    },
  };
}

test("makePage hasText embeds re.toString(), tests document.body text, returns the boolean", async () => {
  const exprs = [];
  const cdp = fakeCdpFor({ "Runtime.evaluate": () => ({ result: { value: true } }) }, exprs);
  const page = await makePage(cdp, "t1");
  assert.equal(await page.hasText(/Magic Layers/i), true);
  const last = exprs[exprs.length - 1];
  assert.ok(last.includes("/Magic Layers/i"));
  assert.ok(last.includes("document.body"));
});

test("makePage hasText swallows an evaluate error as false", async () => {
  const cdp = fakeCdpFor({ "Runtime.evaluate": () => ({ exceptionDetails: { text: "boom" } }) });
  const page = await makePage(cdp, "t1");
  assert.equal(await page.hasText(/x/), false);
});

test("makePage enables Page/Runtime/DOM/Network tolerating rejections; attaches with flatten:true", async () => {
  const calls = [];
  const cdp = {
    send: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === "Target.attachToTarget") return { sessionId: "sess-1" };
      if (method === "DOM.enable") throw new Error("nope");
      return {};
    },
  };
  const page = await makePage(cdp, "t1");
  assert.equal(typeof page, "object");
  assert.equal(page.sessionId, "sess-1");
  const attach = calls.find((c) => c.method === "Target.attachToTarget");
  assert.deepEqual(attach.params, { targetId: "t1", flatten: true });
});
