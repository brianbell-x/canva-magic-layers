// Pure-function and string-contract coverage for canva.js internals.
// No Chrome, no fs, no network (save() integration stubs globalThis.fetch).
// Locks invariants #2 (AUTHED_JS real-auth check — render, not stale cookies),
// #5 (harvestJS XSSI strip), #10 (harvestJS media query params), and the 20-per-batch loop.
const { test } = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");

const { designIdFrom, AUTHED_JS, DISMISS_COOKIES_JS, harvestJS, clickJS, existsJS } = require("../canva");

// --- designIdFrom ---------------------------------------------------------

test("designIdFrom extracts id from a full /design/<id>/edit URL", () => {
  assert.equal(designIdFrom("https://www.canva.com/design/DAHMHPgq1bA/edit"), "DAHMHPgq1bA");
});

test("designIdFrom returns a bare 6+ char [A-Za-z0-9_-] token", () => {
  assert.equal(designIdFrom("DAHMHPgq1bA"), "DAHMHPgq1bA");
  assert.equal(designIdFrom("abc-_9"), "abc-_9");
});

test("designIdFrom returns null for junk and empty/short", () => {
  assert.equal(designIdFrom("foo"), null);
  assert.equal(designIdFrom(""), null);
  assert.equal(designIdFrom("ab"), null);
});

// --- AUTHED_JS (real auth check; cookie presence is NOT trusted) — invariant #2 ------
// Replay the generated in-page JS against a fake DOM. Auth requires BOTH a positive
// signed-in marker (an authed-only nav affordance) AND the absence of a "Log in"/"Sign up"
// control — so stale cookies, a logged-out page, the login form, and a still-hydrating
// page (no marker yet) all correctly read as NOT signed in.
function runAuthed(bodyText, controlTexts, { marker = false } = {}) {
  const doc = {
    body: { innerText: bodyText },
    querySelectorAll: () => controlTexts.map((t) => ({ textContent: t })),
    querySelector: () => (marker ? {} : null),
  };
  return new Function("document", "return " + AUTHED_JS)(doc);
}

test("AUTHED_JS true on the signed-in app: no Log in/Sign up control + a 'Create a design' button", () => {
  assert.equal(runAuthed("Home Projects Templates Brand lots of app chrome text here", ["Create a design", "Notifications"]), true);
});

test("AUTHED_JS true via an authed-only DOM marker (account/notifications/settings/folder)", () => {
  assert.equal(runAuthed("Home Projects Templates Brand lots of app chrome text here", ["Search"], { marker: true }), true);
});

test("AUTHED_JS false on the logged-out homepage (Sign up / Log in CTAs) even with a marker — LOCKS invariant #2", () => {
  assert.equal(runAuthed("Design Product Plans Business Education Help Sign up Log in What will you design today?", ["Sign up", "Log in"], { marker: true }), false);
});

test("AUTHED_JS false on the login form so login() waits for a REAL sign-in (Log in submit present)", () => {
  assert.equal(runAuthed("Log in to your Canva account. Enter your email and password to continue.", ["Continue", "Log in"]), false);
});

test("AUTHED_JS false on a blank/loading page (short body) — no false positive", () => {
  assert.equal(runAuthed("", []), false);
  assert.equal(runAuthed("Loading", []), false);
});

test("AUTHED_JS false when no login control AND no authed marker (still hydrating) — LOCKS the C1 fix", () => {
  assert.equal(runAuthed("Some neutral page text that is long enough to pass the length gate here", ["Search", "Help"]), false);
});

test("AUTHED_JS matches the login control by exact trimmed text, not substrings", () => {
  // "Login help"/"Sign up for newsletter" are NOT login controls; with an authed marker -> true.
  assert.equal(runAuthed("Home Projects Templates app chrome text long enough here", ["Login help", "Sign up for newsletter"], { marker: true }), true);
});

// --- DISMISS_COOKIES_JS (banner blocks the signed-in markers if left up) ----------

test("DISMISS_COOKIES_JS clicks the privacy-preserving 'Reject all cookies', not 'Accept all'", () => {
  const clicked = [];
  const btn = (text) => ({ textContent: text, click: () => clicked.push(text) });
  const doc = { querySelectorAll: () => [btn("Accept all cookies"), btn("Reject all cookies"), btn("Manage cookies")] };
  const r = new Function("document", "return " + DISMISS_COOKIES_JS)(doc);
  assert.equal(r, true);
  assert.deepEqual(clicked, ["Reject all cookies"], "rejects non-essential cookies; never clicks Accept all");
});

test("DISMISS_COOKIES_JS returns false when no banner is present", () => {
  const doc = { querySelectorAll: () => [{ textContent: "Create a design", click() {} }] };
  assert.equal(new Function("document", "return " + DISMISS_COOKIES_JS)(doc), false);
});

// --- harvestJS ------------------------------------------------------------

test("harvestJS interpolates id into all three spots and is an async IIFE", () => {
  const js = harvestJS("DAHMHPgq1bA");
  assert.ok(js.startsWith("(async()=>"), "must start with (async()=>");
  assert.match(js, /\/_ajax\/documents\/DAHMHPgq1bA/);
  assert.match(js, /documentId=DAHMHPgq1bA/);
});

test("harvestJS contains the XSSI strip — LOCKS invariant #5", () => {
  const js = harvestJS("ID");
  assert.ok(js.includes("replace(/^.*?\\/\\//s,'')"));
});

test("harvestJS contains the 20-per-batch loop and ref:1 encoding", () => {
  const js = harvestJS("ID");
  assert.ok(js.includes("i+=20"));
  assert.ok(js.includes("slice(i,i+20)"));
  assert.ok(js.includes("'refs='+encodeURIComponent(r+':1')"));
});

test("harvestJS media query carries all required params — LOCKS invariant #10", () => {
  const js = harvestJS("ID");
  assert.ok(js.includes("projection=FS"));
  assert.ok(js.includes("qualities=SCREEN_3X"));
  assert.ok(js.includes("ignoreForbidden"));
  assert.ok(js.includes("includeRetained"));
  assert.ok(js.includes("batch&"));
});

test("harvestJS uses credentials include and the MA-ref + media.canva.com regexes", () => {
  const js = harvestJS("ID");
  assert.ok(js.includes("credentials:'include'"));
  assert.ok(js.includes("MA[A-Za-z0-9_-]{8,12}"));
  assert.ok(js.includes("media\\.canva\\.com"));
});

test("harvestJS output is eval-safe and runs against a stubbed fetch (dedupe + batch + index pairing)", async () => {
  // Doc body with MA-refs: two unique, one duplicate (must dedupe to a Set).
  const docBody = "noise MAaaaaaaaa1 more MAbbbbbbbb2 dup MAaaaaaaaa1 tail";
  // Media body returns media.canva.com URLs, paired to refs by index.
  const mediaBody = '{"u":["https://media.canva.com/x/one.png","https://media.canva.com/x/two.png"]}';
  const XSSI = ")]}',//"; // leading XSSI guard: the strip removes everything up to & incl. the first //

  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const body = /\/_ajax\/documents\//.test(url) ? XSSI + docBody : XSSI + mediaBody;
    return { text: async () => body };
  };

  const sandbox = { fetch: fakeFetch, encodeURIComponent, Set, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const result = await vm.runInContext("(" + harvestJS("ID") + ")", sandbox);

  // refs deduped via Set: MAaaaaaaaa1 appears twice in doc -> one entry.
  assert.deepEqual(result.refs, ["MAaaaaaaaa1", "MAbbbbbbbb2"]);
  // doc is the XSSI-stripped document body.
  assert.equal(result.doc, docBody);
  // ref<->url paired by index, one batch (<=20 refs).
  assert.deepEqual(result.layers, [
    { ref: "MAaaaaaaaa1", url: "https://media.canva.com/x/one.png" },
    { ref: "MAbbbbbbbb2", url: "https://media.canva.com/x/two.png" },
  ]);
  // one /_ajax/documents call + one /_ajax/media batch call for 2 refs.
  assert.equal(calls.filter((u) => /\/_ajax\/documents\//.test(u)).length, 1);
  assert.equal(calls.filter((u) => /\/_ajax\/media/.test(u)).length, 1);
  assert.match(calls.find((u) => /\/_ajax\/media/.test(u)), /refs=MAaaaaaaaa1%3A1/);
});

// --- clickJS / existsJS (editor control addressing by accessible name) ----
// Both address a control by its trimmed accessible name (aria-label, else text).
// clickJS clicks the first match and reports whether one was found; existsJS only
// reports presence. Replay the generated JS against a fake DOM.
function runDom(js, els) {
  const nodes = els.map((e) => ({
    getAttribute: (k) => (k === "aria-label" ? e.aria ?? null : null),
    textContent: e.text ?? "",
    click: () => { e.clicked = true; },
  }));
  return new Function("document", "return " + js)({ querySelectorAll: () => nodes });
}

test("clickJS clicks the first control whose accessible name matches and returns true", () => {
  const els = [{ text: "Cancel" }, { aria: "Upload files" }, { text: "Upload files" }];
  assert.equal(runDom(clickJS(/^upload files$/i), els), true);
  assert.equal(els[1].clicked, true, "first match (the aria-label one) is clicked");
  assert.ok(!els[2].clicked, "only the first match is clicked");
});

test("clickJS prefers aria-label, falls back to textContent, anchors exactly", () => {
  // anchored: 'Uploads' (the tab) must NOT match /^upload files$/i.
  assert.equal(runDom(clickJS(/^upload files$/i), [{ text: "Uploads" }]), false);
  // text fallback when no aria-label.
  const els = [{ text: "Magic Layers" }];
  assert.equal(runDom(clickJS(/^magic layers$/i), els), true);
  assert.equal(els[0].clicked, true);
});

test("clickJS returns false (clicks nothing) when no control matches", () => {
  const els = [{ text: "Templates" }, { aria: "Elements" }];
  assert.equal(runDom(clickJS(/^magic layers$/i), els), false);
  assert.ok(els.every((e) => !e.clicked), "no control is clicked on a miss");
});

test("existsJS reports presence by accessible name without clicking", () => {
  const els = [{ aria: "Uploads" }];
  assert.equal(runDom(existsJS(/^uploads?$/i), els), true);
  assert.equal(runDom(existsJS(/^upload files$/i), els), false);
  assert.ok(!els[0].clicked, "existsJS never clicks");
});
