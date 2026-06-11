// Live end-to-end smoke tests for the Canva Magic Layers skill.
//
// These exercise the REAL stack: a real installed Chrome/Edge/Brave (found via
// chrome.findChrome) driven over CDP, against a real logged-in Canva profile. They
// touch the network and Canva's account UI, so they CANNOT run on CI or on a fresh
// device with no browser/login. Every test here is gated behind CANVA_LIVE=1 and is
// SKIPPED by default, so `node --test` stays green everywhere with zero setup.
//
// This file is also the manual contract: it documents exactly which env vars unlock
// which path, and what a passing live run asserts. The pure/offline invariant tests
// (designIdFrom, AUTHED_JS, harvestJS, clickJS, existsJS, harvestPage, waitForLayers,
// save, buildArgs, CDP, readPort, makePage, evaluate) live in the unit files, NOT here.
//
// Manual run contract:
//   1. node scripts/cli.js login    (one-time, opens Chrome, sign in to Canva)
//   2. Auth check (real Chrome + logged-in profile):
//        CANVA_LIVE=1 node --test test/live.integration.test.js
//   3. Harvest a known already-split design:
//        CANVA_LIVE=1 CANVA_TEST_DESIGN=<url-or-id> node --test test/live.integration.test.js
//   4. Full decompose flow — open editor -> upload -> Magic Layers -> harvest
//      (heaviest, double-gated; consumes one AI allowance; supply your own high-res image):
//        CANVA_LIVE=1 CANVA_FULL=1 CANVA_TEST_IMAGE=<path-to-image> node --test test/live.integration.test.js
//   (On Windows PowerShell use:  $env:CANVA_LIVE=1; node --test test\live.integration.test.js)
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const canva = require("../scripts/canva");

const LIVE = process.env.CANVA_LIVE === "1";
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `canva-live-${tag}-`));
const rm = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// --- Case 1: status() against real Chrome returns a boolean ------------------
// Launches a real offscreen-headed Chrome on the persistent profile and checks whether
// the app renders signed-in. Needs a working browser (findChrome) but NOT a login:
// status() returns false when not signed in, so this only locks the return TYPE.
test(
  "status() against real Chrome returns a boolean",
  { skip: LIVE ? false : "set CANVA_LIVE=1" },
  async () => {
    const result = await canva.status();
    assert.strictEqual(typeof result, "boolean");
  }
);

// --- Case 2: harvest() of a known split design downloads >= 1 layer ----------
// Requires the logged-in PROFILE plus a design id/url (CANVA_TEST_DESIGN) that has
// ALREADY had Magic Layers run on it. Asserts the on-disk contract: manifest.json
// plus at least one layer_*.png, and a count that matches.
test(
  "harvest() of a known split design downloads >= 1 layer",
  { skip: LIVE && process.env.CANVA_TEST_DESIGN ? false : "set CANVA_LIVE=1 and CANVA_TEST_DESIGN=<url-or-id>" },
  async (t) => {
    t.timeout = 240000;
    const out = tmp("harvest");
    try {
      const result = await canva.harvest(process.env.CANVA_TEST_DESIGN, out);
      assert.ok(result.count >= 1, `expected >=1 layer, got ${result.count}`);

      const files = fs.readdirSync(out);
      assert.ok(files.includes("manifest.json"), "manifest.json must exist");
      assert.ok(
        files.some((f) => /^layer_\d+_.+\.png$/.test(f)),
        "at least one layer_*.png must exist"
      );

      const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
      assert.strictEqual(manifest.length, result.count);
    } finally {
      rm(out);
    }
  }
);

// --- Case 3: decompose() of an example image produces layers ------------------
// The full hands-off flow: open a blank editor -> upload the image into it (intercepted
// file chooser, sniff the minted media ref) -> place it -> run Magic Layers -> read the
// job result off the wire -> harvest the in-place layers. Double-gated behind CANVA_FULL=1
// because it takes minutes and consumes an AI allowance. Magic Layers REJECTS low-res
// images ("too small"), so supply a high-resolution image via CANVA_TEST_IMAGE.
test(
  "decompose() of a supplied image produces layers",
  { skip: LIVE && process.env.CANVA_FULL === "1" && process.env.CANVA_TEST_IMAGE ? false : "set CANVA_LIVE=1, CANVA_FULL=1, and CANVA_TEST_IMAGE=<path to a high-res image>", timeout: 600000 },
  async (t) => {
    t.timeout = 600000;
    const out = tmp("decompose");
    try {
      const result = await canva.decompose(process.env.CANVA_TEST_IMAGE, out);
      assert.ok(result.count >= 2, `expected >=2 layers, got ${result.count}`);
    } finally {
      rm(out);
    }
  }
);
