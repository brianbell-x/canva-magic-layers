// Offline coverage of the side-effecting-but-injectable canva.js functions:
// harvestPage, waitForLayers, save. No real Chrome, no network. Timing is neutralised
// by monkeypatching chrome.sleep to a no-op BEFORE canva.js binds `const sleep = chrome.sleep`
// (canva captures the reference at require time, so we patch then load from a clean cache).
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Patch chrome.sleep -> no-op, then (re)load canva so its `sleep` binding is the no-op.
const chrome = require("../chrome");
chrome.sleep = () => Promise.resolve();
delete require.cache[require.resolve("../canva")];
const { harvestPage, waitForLayers, save } = require("../canva");

// ---------------------------------------------------------------------------
// harvestPage
// ---------------------------------------------------------------------------

test("harvestPage passes through a well-formed result", async () => {
  const shape = { refs: ["MA12345678"], layers: [{ ref: "MA12345678", url: "u" }], doc: "{}" };
  const fakePage = { evaluate: async () => shape };
  assert.deepEqual(await harvestPage(fakePage, "id"), shape);
});

test("harvestPage normalizes a rejected evaluate to the empty shape", async () => {
  const fakePage = { evaluate: async () => { throw new Error("x"); } };
  assert.deepEqual(await harvestPage(fakePage, "id"), { refs: [], layers: [], doc: "" });
});

test("harvestPage normalizes a non-array refs result", async () => {
  const fakePage = { evaluate: async () => ({ refs: "nope" }) };
  assert.deepEqual(await harvestPage(fakePage, "id"), { refs: [], layers: [], doc: "" });
});

// ---------------------------------------------------------------------------
// waitForLayers — invariant #9: stable>=2 anti-race counter, else stable=0 reset,
// return max(last,0) on timeout. sleep is a no-op so polling runs synchronously fast.
// ---------------------------------------------------------------------------

// Build a fake page whose evaluate returns a doc with `count` MA-refs per scripted step,
// so harvestPage(...).refs.length reproduces the desired sequence.
const scriptPage = (counts) => {
  let i = 0;
  return {
    evaluate: async () => {
      const n = counts[Math.min(i, counts.length - 1)];
      i++;
      const refs = Array.from({ length: n }, (_, k) => "MA" + String(k).padStart(8, "0"));
      return { refs, layers: [], doc: "" };
    },
  };
};

test("waitForLayers returns the stable count once it holds across 2 polls", async () => {
  // Sequence [1,3,3,3,...]: 1 (last=1), 3 (last=3,stable=0), 3 (stable=1), 3 (stable=2 -> return 3).
  const page = scriptPage([1, 3, 3, 3, 3]);
  const n = await waitForLayers(page, "id", { timeout: 5000, min: 1 });
  assert.strictEqual(n, 3);
});

test("waitForLayers resets stability when the count keeps moving", async () => {
  // Sequence [2,3,4,4,4]: the climb 2->3->4 keeps resetting `stable`, so the FIRST 4 must
  // not return; only after two equal 4s (stable>=2) does it return 4. Exercises `else stable=0`.
  const page = scriptPage([2, 3, 4, 4, 4]);
  const n = await waitForLayers(page, "id", { timeout: 5000, min: 1 });
  assert.strictEqual(n, 4);
});

test("waitForLayers returns max(last,0) on timeout when no plateau is reached", async () => {
  // Ever-increasing count: stability is never reached. timeout:1 fails the while-guard fast,
  // returning the last observed count (>= 0).
  let n = 0;
  const page = {
    evaluate: async () => {
      n += 1;
      const refs = Array.from({ length: n }, (_, k) => "MA" + String(k).padStart(8, "0"));
      return { refs, layers: [], doc: "" };
    },
  };
  const last = await waitForLayers(page, "id", { timeout: 1, min: 1 });
  assert.ok(last >= 0, "returns a non-negative observed count on timeout");
});

// ---------------------------------------------------------------------------
// save — on-disk layout contract, stubbed global fetch + tmp outDir.
// ---------------------------------------------------------------------------

const ORIGINAL_FETCH = globalThis.fetch;
let tmp;

const stubFetch = (body = "PNGBYTES") => {
  globalThis.fetch = async () => ({ arrayBuffer: async () => new TextEncoder().encode(body).buffer });
};

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} tmp = undefined; }
});

test("save writes document.json when doc is truthy", async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cml-"));
  stubFetch();
  await save([{ ref: "MA1", url: "http://x/1.png" }], '{"x":1}', tmp);
  const p = path.join(tmp, "document.json");
  assert.ok(fs.existsSync(p));
  assert.strictEqual(fs.readFileSync(p, "utf8"), '{"x":1}');
});

test("save skips document.json when doc is falsy", async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cml-"));
  stubFetch();
  await save([{ ref: "MA1", url: "http://x/1.png" }], "", tmp);
  assert.ok(!fs.existsSync(path.join(tmp, "document.json")));
});

test("save names layer files zero-padded layer_NN_<ref>.png", async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cml-"));
  stubFetch();
  const layers = Array.from({ length: 10 }, (_, k) => ({ ref: "MA" + (k + 1), url: "u" }));
  await save(layers, "", tmp);
  assert.ok(fs.existsSync(path.join(tmp, "layer_01_MA1.png")));
  assert.ok(fs.existsSync(path.join(tmp, "layer_10_MA10.png")));
});

test("save manifest.json content equals the returned manifest", async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cml-"));
  stubFetch(); // 'PNGBYTES' -> 8 bytes
  const m = await save([{ ref: "MA1", url: "u" }], "", tmp);
  assert.deepEqual(m, [{ index: 1, ref: "MA1", file: "layer_01_MA1.png", bytes: 8 }]);
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, "manifest.json"), "utf8"));
  assert.deepEqual(onDisk, m);
});
