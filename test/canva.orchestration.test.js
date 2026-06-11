// Offline orchestration tests for canva.js (harvest / decompose / login / status).
//
// Strategy: canva.js does `const chrome = require("./chrome")` and captures
// `const sleep = chrome.sleep` AT MODULE LOAD. So we inject a fake ./chrome into
// require.cache BEFORE (re)requiring ../canva, with a no-op sleep that is present
// at load time. Each test reloads canva with a freshly-configured fake chrome so
// chrome.launch behaviour can be scripted per case. globalThis.fetch is stubbed
// (and restored) wherever save() runs; Date.now is monkeypatched to force the
// bounded poll loops to expire without real waiting. No real Chrome, no network.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const CHROME_PATH = require.resolve("../chrome");
const CANVA_PATH = require.resolve("../canva");

// Install a fake ./chrome and load a pristine ../canva that binds to it.
function loadCanva(fakeChrome) {
  // sleep must be a no-op present at load (canva.js captures it as a const).
  if (typeof fakeChrome.sleep !== "function") fakeChrome.sleep = async () => {};
  if (!("PROFILE" in fakeChrome)) fakeChrome.PROFILE = "p";
  require.cache[CHROME_PATH] = { id: CHROME_PATH, filename: CHROME_PATH, loaded: true, exports: fakeChrome };
  delete require.cache[CANVA_PATH];
  return require("../canva");
}

function restoreModules() {
  delete require.cache[CHROME_PATH];
  delete require.cache[CANVA_PATH];
}

// A page whose evaluate() resolves the same {refs,layers,doc} every call, so
// waitForLayers' stable>=2 counter settles after a few no-op-sleep iterations.
function pageReturning(result) {
  return { evaluate: async () => result };
}

// tmp dir helper with cleanup.
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canva-orch-"));
  return { dir, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Stub global fetch so save() writes deterministic bytes to disk.
function withFetch(bytes, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ arrayBuffer: async () => Buffer.from(bytes) });
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = orig; });
}

// Force a Date.now()-bounded `while (Date.now()-start < T)` loop to expire after
// `iterations` calls (the first call captures `start`).
function forceTimeoutAfter(iterations) {
  const realNow = Date.now;
  let n = 0;
  Date.now = () => (n++ < iterations ? 0 : 1e12);
  return () => { Date.now = realNow; };
}

// A throwaway image file on disk (decompose's fs.existsSync gate needs a real path).
function tmpImg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "canva-up-"));
  const p = path.join(dir, "img.png");
  fs.writeFileSync(p, Buffer.from([1, 2, 3]));
  return { p, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// harvest
// ---------------------------------------------------------------------------

test("harvest throws 'Could not parse a design id' before any launch", async () => {
  let launched = false;
  const fake = { launch: async () => { launched = true; throw new Error("should not launch"); } };
  const canva = loadCanva(fake);
  try {
    await assert.rejects(canva.harvest("not a design"), /Could not parse a design id/);
    assert.strictEqual(launched, false, "launch must not be invoked when id is unparseable");
  } finally { restoreModules(); }
});

test("harvest happy path returns {designId,count,outDir} and closes", async () => {
  const t = tmp();
  const layers = [{ ref: "MA1", url: "https://media.canva.com/a.png" }, { ref: "MA2", url: "https://media.canva.com/b.png" }];
  let closeCalls = 0;
  const fake = {
    launch: async () => ({ page: pageReturning({ refs: ["MA1", "MA2"], layers, doc: "{}" }), close: async () => { closeCalls++; } }),
  };
  const canva = loadCanva(fake);
  try {
    await withFetch([1, 2, 3], async () => {
      const r = await canva.harvest("https://www.canva.com/design/DAHMHPgq1bA/edit", t.dir);
      assert.strictEqual(r.designId, "DAHMHPgq1bA");
      assert.strictEqual(r.count, layers.length);
      assert.strictEqual(r.outDir, t.dir);
      assert.strictEqual(closeCalls, 1, "close must run exactly once");
    });
  } finally { restoreModules(); t.clean(); }
});

test("harvest throws 'No layers found' when layers empty and still closes (finally)", async () => {
  let closeCalls = 0;
  // refs present so waitForLayers settles, but layers array empty.
  const fake = {
    launch: async () => ({ page: pageReturning({ refs: ["MA1"], layers: [], doc: "" }), close: async () => { closeCalls++; } }),
  };
  const canva = loadCanva(fake);
  try {
    await assert.rejects(canva.harvest("DAHMHPgq1bA"), /No layers found/);
    assert.strictEqual(closeCalls, 1, "finally must close even on the No-layers throw");
  } finally { restoreModules(); }
});

test("harvest default outDir = path.join('out', id)", async () => {
  const layers = [{ ref: "MA1", url: "https://media.canva.com/a.png" }];
  const fake = {
    launch: async () => ({ page: pageReturning({ refs: ["MA1"], layers, doc: "" }), close: async () => {} }),
  };
  const canva = loadCanva(fake);
  const expected = path.join("out", "DAHMHPgq1bA");
  try {
    await withFetch([0], async () => {
      const r = await canva.harvest("https://www.canva.com/design/DAHMHPgq1bA/edit");
      assert.strictEqual(r.outDir, expected);
    });
  } finally {
    restoreModules();
    fs.rmSync(path.join("out", "DAHMHPgq1bA"), { recursive: true, force: true });
  }
});

test("harvest requests offscreen headed (not headless) by default; HEADED=1 -> offscreen false", async () => {
  const layers = [{ ref: "MA1", url: "https://media.canva.com/a.png" }];
  let opts;
  const mkFake = () => ({
    launch: async (o) => { opts = o; return { page: pageReturning({ refs: ["MA1"], layers, doc: "" }), close: async () => {} }; },
  });
  const prev = process.env.HEADED;
  try {
    delete process.env.HEADED;
    let canva = loadCanva(mkFake());
    await withFetch([0], () => canva.harvest("DAHMHPgq1bA", tmp().dir));
    assert.strictEqual(opts.offscreen, true, "default is offscreen-headed");
    assert.strictEqual(opts.headless, undefined, "must never request headless for harvest");

    process.env.HEADED = "1";
    canva = loadCanva(mkFake());
    await withFetch([0], () => canva.harvest("DAHMHPgq1bA", tmp().dir));
    assert.strictEqual(opts.offscreen, false, "HEADED=1 disables offscreen (visible window)");
  } finally {
    if (prev === undefined) delete process.env.HEADED; else process.env.HEADED = prev;
    restoreModules();
  }
});

// ---------------------------------------------------------------------------
// decompose — full editor-driven flow against a scripted CDP session
// ---------------------------------------------------------------------------
//
// A fake { page, cdp, close } that plays the editor flow: page.evaluate dispatches
// by the in-page JS it's handed (location/href, cookie/popup dismiss, the Uploads +
// Upload-files controls, place, Edit, Magic Layers, and the harvest fetch). cdp.send
// emits the real CDP events into the live onmessage tap decompose installs — the file
// chooser (on the user-gesture Runtime.evaluate), the minted media ref (on
// setFileInputFiles), and the Magic Layers getToolJobResult body (whose discriminator
// drives success/error). So the chooser handling, ref sniff, job-result parse, and the
// wait/harvest all run for real.
function decomposeSession(opts = {}) {
  const {
    href = "https://www.canva.com/design/DAtest12345/abc/edit",
    refUrl = "https://www.canva.com/_ajax/media/MAnew123/1?q",
    jobBody = '{"A?":"A","E":[]}',                  // success discriminator by default
    harvest = { refs: ["MA1", "MA2"], layers: [{ ref: "MA1", url: "https://media.canva.com/a.png" }, { ref: "MA2", url: "https://media.canva.com/b.png" }], doc: "{}" },
    uploadFilesPresent = true,
    placeOk = true,
  } = opts;
  let closeCalls = 0;
  const ws = { onmessage: () => {} };
  const emit = (msg) => ws.onmessage({ data: JSON.stringify(msg) });
  const cdp = {
    ws,
    send: async (method) => {
      if (method === "Runtime.evaluate") emit({ method: "Page.fileChooserOpened", params: { backendNodeId: 42 } });
      if (method === "DOM.setFileInputFiles") emit({ method: "Network.requestWillBeSent", params: { request: { url: refUrl } } });
      // Emit the Magic Layers job result once the upload phase is wrapping up; the
      // loadingFinished handler then calls getResponseBody (below) to read the body.
      if (method === "Page.setInterceptFileChooserDialog") {
        emit({ method: "Network.responseReceived", params: { requestId: "r1", response: { url: "https://www.canva.com/_ajax/designgeneration/getToolJobResult?x" } } });
        emit({ method: "Network.loadingFinished", params: { requestId: "r1" } });
      }
      if (method === "Network.getResponseBody") return { body: jobBody };
      return {};
    },
  };
  const page = {
    sessionId: "sid",
    evaluate: async (js) => {
      if (js.includes("/_ajax/documents/")) return harvest;
      if (js === "location.href") return href;
      if (js.includes("reject all cookies")) return false;
      if (js.includes("Close|Skip")) return false;
      if (js.includes("upload files")) return uploadFilesPresent;
      if (js.includes("uploads?")) return true;       // Uploads tab present/clicked
      if (js.includes("MouseEvent")) return placeOk;   // place the image
      return true;                                     // Edit, Magic Layers, etc.
    },
  };
  return { page, cdp, close: async () => { closeCalls++; }, closes: () => closeCalls };
}

test("decompose throws 'Image not found' before launch", async () => {
  let launched = false;
  const fake = { launch: async () => { launched = true; throw new Error("should not launch"); } };
  const canva = loadCanva(fake);
  try {
    await assert.rejects(canva.decompose("C:/does/not/exist_" + Date.now() + ".png"), /Image not found/);
    assert.strictEqual(launched, false, "fs.existsSync gate must precede launch");
  } finally { restoreModules(); }
});

test("decompose throws NOAUTH when the editor URL is a /login redirect; closes", async () => {
  const img = tmpImg();
  const s = decomposeSession({ href: "https://www.canva.com/login" });
  const fake = { launch: async () => s };
  const canva = loadCanva(fake);
  try {
    await assert.rejects(canva.decompose(img.p), /Not signed in/);
    assert.strictEqual(s.closes(), 1, "finally must close");
  } finally { restoreModules(); img.clean(); }
});

test("decompose happy path: upload -> place -> Magic Layers -> harvest returns {designId,count,outDir}; closes once", async () => {
  const t = tmp();
  const img = tmpImg();
  const s = decomposeSession();
  const fake = { launch: async () => s };
  const canva = loadCanva(fake);
  try {
    await withFetch([1, 2, 3], async () => {
      const r = await canva.decompose(img.p, t.dir);
      assert.strictEqual(r.designId, "DAtest12345");
      assert.strictEqual(r.count, 2);
      assert.strictEqual(r.outDir, t.dir);
      assert.strictEqual(s.closes(), 1, "close must run exactly once");
    });
  } finally { restoreModules(); t.clean(); img.clean(); }
});

test("decompose surfaces Canva's own error message from the job result (e.g. image too small)", async () => {
  const img = tmpImg();
  // Error discriminator "B" with Canva's message in the "A" field, and no layers in the doc.
  const s = decomposeSession({
    jobBody: '{"A?":"B","A":"This image is too small for this action. Use a higher-resolution file.","D":"This image is too small for this action."}',
    harvest: { refs: [], layers: [], doc: "" },
  });
  const fake = { launch: async () => s };
  const canva = loadCanva(fake);
  try {
    await assert.rejects(canva.decompose(img.p), /Magic Layers: This image is too small/);
    assert.strictEqual(s.closes(), 1, "finally must close on the error throw");
  } finally { restoreModules(); img.clean(); }
});

test("decompose throws when the uploaded image can't be placed on the canvas", async () => {
  const img = tmpImg();
  const s = decomposeSession({ placeOk: false });
  const fake = { launch: async () => s };
  const canva = loadCanva(fake);
  try {
    await assert.rejects(canva.decompose(img.p), /Could not place the uploaded image/);
  } finally { restoreModules(); img.clean(); }
});

test("decompose default outDir = out/<image basename>", async () => {
  const img = tmpImg(); // .../img.png
  const s = decomposeSession();
  const fake = { launch: async () => s };
  const canva = loadCanva(fake);
  const expected = path.join("out", "img");
  try {
    await withFetch([0], async () => {
      const r = await canva.decompose(img.p);
      assert.strictEqual(r.outDir, expected);
    });
  } finally { restoreModules(); img.clean(); fs.rmSync(expected, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

// login waits for a REAL signed-in render (page.evaluate(AUTHED_JS) -> true), not cookies.
test("login returns true once the page renders signed-in, closes, launch headless:false", async () => {
  let closeCalls = 0, opts;
  const fake = {
    launch: async (o) => { opts = o; return { page: { evaluate: async () => true }, close: async () => { closeCalls++; } }; },
  };
  const canva = loadCanva(fake);
  const origWrite = process.stdout.write;
  process.stdout.write = () => true; // swallow the prompt
  try {
    assert.strictEqual(await canva.login(), true);
    assert.strictEqual(closeCalls, 1, "close must run once");
    assert.strictEqual(opts.headless, false, "login launches a visible window");
  } finally { process.stdout.write = origWrite; restoreModules(); }
});

test("login returns false after the poll budget when the page never renders signed-in", async () => {
  let closeCalls = 0;
  const fake = {
    launch: async () => ({ page: { evaluate: async () => false }, close: async () => { closeCalls++; } }),
  };
  const canva = loadCanva(fake);
  const origWrite = process.stdout.write;
  process.stdout.write = () => true;
  const restoreNow = forceTimeoutAfter(2); // expire the 300000ms loop fast
  try {
    assert.strictEqual(await canva.login(), false);
    assert.strictEqual(closeCalls, 1, "finally must close");
  } finally { restoreNow(); process.stdout.write = origWrite; restoreModules(); }
});

test("login treats an evaluate rejection as not-signed-in", async () => {
  const fake = {
    launch: async () => ({ page: { evaluate: async () => { throw new Error("nope"); } }, close: async () => {} }),
  };
  const canva = loadCanva(fake);
  const origWrite = process.stdout.write;
  process.stdout.write = () => true;
  const restoreNow = forceTimeoutAfter(2);
  try {
    assert.strictEqual(await canva.login(), false, "isAuthed catch -> false");
  } finally { restoreNow(); process.stdout.write = origWrite; restoreModules(); }
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

test("status returns true when the app renders signed-in; always closes; offscreen-headed by default", async () => {
  let closeCalls = 0, opts;
  const fake = {
    launch: async (o) => { opts = o; return { page: { evaluate: async () => true }, close: async () => { closeCalls++; } }; },
  };
  const canva = loadCanva(fake);
  const prev = process.env.HEADED;
  try {
    delete process.env.HEADED;
    assert.strictEqual(await canva.status(), true);
    assert.strictEqual(closeCalls, 1, "finally must close");
    assert.strictEqual(opts.offscreen, true, "status renders the app offscreen-headed (not headless)");
    assert.strictEqual(opts.headless, undefined, "must not use headless — Cloudflare challenges it");
  } finally { if (prev === undefined) delete process.env.HEADED; else process.env.HEADED = prev; restoreModules(); }
});

test("status returns false when the app renders logged-out (stale cookies can't fake it)", async () => {
  const fake = {
    launch: async () => ({ page: { evaluate: async () => false }, close: async () => {} }),
  };
  const canva = loadCanva(fake);
  try {
    assert.strictEqual(await canva.status(), false);
  } finally { restoreModules(); }
});

test("status returns false when evaluate rejects", async () => {
  const fake = {
    launch: async () => ({ page: { evaluate: async () => { throw new Error("nope"); } }, close: async () => {} }),
  };
  const canva = loadCanva(fake);
  try {
    assert.strictEqual(await canva.status(), false);
  } finally { restoreModules(); }
});
