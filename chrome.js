// Zero-dependency Chrome driver over the DevTools Protocol.
// Uses only Node 22 built-ins: fetch, WebSocket, child_process. No playwright.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROFILE = process.env.PROFILE || path.join(os.homedir(), ".canva-magic-layers-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Locate an installed Chromium-family browser; no binary is bundled or downloaded.
function findChrome() {
  if (process.env.CANVA_CHROME && fs.existsSync(process.env.CANVA_CHROME)) return process.env.CANVA_CHROME;
  const c = [];
  if (process.platform === "win32") {
    for (const r of [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean))
      c.push(`${r}\\Google\\Chrome\\Application\\chrome.exe`, `${r}\\Microsoft\\Edge\\Application\\msedge.exe`, `${r}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`);
  } else if (process.platform === "darwin") {
    c.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser");
  } else {
    c.push("/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge", "/usr/bin/brave-browser", "/opt/google/chrome/chrome", "/snap/bin/chromium");
  }
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("No Chrome/Edge/Brave found. Install Google Chrome or set CANVA_CHROME to its executable path.");
  return hit;
}

// Minimal CDP JSON-RPC client: correlate replies by id, route nothing else.
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const p = m.id && this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const openWS = (url) => new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(ws); ws.onerror = () => rej(new Error("Could not open CDP WebSocket")); });

async function readPort(profile, timeout = 20000) {
  const f = path.join(profile, "DevToolsActivePort"), start = Date.now();
  while (Date.now() - start < timeout) {
    try { const p = fs.readFileSync(f, "utf8").split("\n")[0].trim(); if (p) return p; } catch {}
    await sleep(200);
  }
  throw new Error("Chrome did not expose a debugging port (is it already running on this profile?).");
}

async function evaluate(cdp, sid, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sid);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || "eval error");
  return result.value;
}

// Wrap a page target as a small driver: run in-page JS (evaluate) and a text predicate
// (hasText). Page/Runtime/DOM/Network are enabled so callers can also drive the session
// directly over CDP (Page.setInterceptFileChooserDialog, DOM.setFileInputFiles, …).
async function makePage(cdp, targetId) {
  const { sessionId: sid } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  for (const d of ["Page", "Runtime", "DOM", "Network"]) await cdp.send(`${d}.enable`, {}, sid).catch(() => {});
  return {
    sessionId: sid,
    evaluate: (expr) => evaluate(cdp, sid, expr),
    hasText: (re) => evaluate(cdp, sid, `(()=>{const rx=${re.toString()};return rx.test(document.body&&document.body.innerText||"");})()`).catch(() => false),
  };
}

async function firstPage(cdp, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = (await cdp.send("Target.getTargets")).targetInfos.find((t) => t.type === "page" && !/^(chrome|devtools)/.test(t.url));
    if (t) return makePage(cdp, t.targetId);
    await sleep(300);
  }
  throw new Error("No page opened in Chrome.");
}

// Build Chrome's launch argv. Pure (no spawn) so the load-bearing flags stay testable.
// --remote-allow-origins=* is mandatory for the CDP WebSocket handshake; headed Chrome
// (offscreen) is required because Cloudflare challenges headless.
// The VISIBLE (login) launch MUST set its own on-screen position+size: the offscreen runs
// persist their -32000,-32000 placement into the shared profile, and with no command-line
// geometry Chrome would restore those off-screen bounds for the visible window. The
// command line overrides the saved bounds for the initial window; pass BOTH (position
// alone leaves the saved size/maximized state).
const buildArgs = (profile, opts = {}) => {
  const a = ["--remote-debugging-port=0", `--user-data-dir=${profile}`, "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"];
  if (opts.headless) a.push("--headless=new", "--disable-gpu", "--window-size=1600,1000");
  else if (opts.offscreen) a.push("--window-position=-32000,-32000", "--window-size=1280,900");
  else a.push("--window-position=80,60", "--window-size=1200,900");
  a.push(opts.startUrl || "about:blank");
  return a;
};

// Launch Chrome on a persistent profile and attach over CDP. Returns the first page, the
// CDP client (for direct session calls), and a close().
async function launch(opts = {}) {
  const exe = findChrome(), profile = opts.profile || PROFILE;
  fs.mkdirSync(profile, { recursive: true });
  try { fs.rmSync(path.join(profile, "DevToolsActivePort")); } catch {}
  const proc = spawn(exe, buildArgs(profile, opts), { stdio: "ignore" });
  const port = await readPort(profile);
  const ws = await openWS((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
  const cdp = new CDP(ws);
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  const page = await firstPage(cdp);
  return {
    page, cdp,
    close: async () => { try { await cdp.send("Browser.close"); } catch {} try { ws.close(); } catch {} try { proc.kill(); } catch {} },
  };
}

module.exports = { launch, findChrome, PROFILE, sleep, buildArgs, CDP, readPort, makePage, evaluate };
