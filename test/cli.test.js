// In-process tests of the exported cli run(argv, deps) and the USAGE template.
// No Chrome, no child process, no network: every command handler is a stub passed via deps.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { run, USAGE } = require("../scripts/cli");

// --- console / exitCode capture harness -------------------------------------
// run() writes success to console.log and errors to console.error, and signals
// failure with process.exitCode = 1 (so in-process tests aren't killed).
function capture() {
  const logged = [], errored = [];
  const log = console.log, error = console.error;
  console.log = (...a) => logged.push(a.join(" "));
  console.error = (...a) => errored.push(a.join(" "));
  return {
    logged, errored,
    out: () => logged.join("\n"),
    err: () => errored.join("\n"),
    restore: () => { console.log = log; console.error = error; },
  };
}

// A spy that records its args and resolves to a configurable value.
function spy(value) {
  const fn = async (...args) => { fn.calls.push(args); return typeof value === "function" ? value(...args) : value; };
  fn.calls = [];
  return fn;
}

// Full set of handler spies so an unexpected dispatch is observable as a call.
function allSpies(over = {}) {
  return Object.assign(
    { status: spy(true), login: spy(true), doctor: spy({ node: "22.0.0", nodeOk: true, chrome: "/x/chrome", signedIn: true }), decompose: spy({ count: 0, outDir: "", designId: "" }), harvest: spy({ count: 0, outDir: "", designId: "" }) },
    over
  );
}

// process.exitCode is process-global; reset after every test (per the refactor it is
// set to 1 on failure instead of process.exit(1)).
afterEach(() => { process.exitCode = 0; });

// --- USAGE template ----------------------------------------------------------
test("USAGE lists every command and the Env line", () => {
  assert.ok(USAGE.includes("login"), "USAGE mentions login");
  assert.ok(USAGE.includes("status"), "USAGE mentions status");
  assert.ok(USAGE.includes("decompose"), "USAGE mentions decompose");
  assert.ok(USAGE.includes("harvest"), "USAGE mentions harvest");
  assert.ok(USAGE.includes("doctor"), "USAGE mentions the doctor self-check command");
  assert.ok(USAGE.includes("CANVA_CHROME"), "USAGE documents CANVA_CHROME env var");
  assert.ok(USAGE.includes("HEADED"), "USAGE documents HEADED env var");
  assert.ok(USAGE.includes("PROFILE"), "USAGE documents PROFILE env var");
});

// --- no args / unknown command falls through to USAGE ------------------------
test("no args prints USAGE and calls no handler", async () => {
  const c = capture();
  const deps = allSpies();
  try {
    await run(["node", "cli.js"], deps);
  } finally { c.restore(); }
  assert.ok(c.out().includes("canva-magic-layers"), "prints the USAGE banner");
  for (const k of ["status", "login", "decompose", "harvest"])
    assert.strictEqual(deps[k].calls.length, 0, `${k} handler not called`);
  assert.notStrictEqual(process.exitCode, 1, "no-arg usage is not a failure");
});

test("unknown command prints USAGE and calls no handler", async () => {
  const c = capture();
  const deps = allSpies();
  try {
    await run(["node", "cli.js", "bogus"], deps);
  } finally { c.restore(); }
  assert.ok(c.out().includes("canva-magic-layers"), "prints the USAGE banner");
  for (const k of ["status", "login", "decompose", "harvest"])
    assert.strictEqual(deps[k].calls.length, 0, `${k} handler not called`);
});

// --- status ------------------------------------------------------------------
test("status true prints the signed-in confirmation", async () => {
  const c = capture();
  try {
    await run(["node", "cli.js", "status"], allSpies({ status: async () => true }));
  } finally { c.restore(); }
  assert.strictEqual(c.out(), "Signed in to Canva. ✓");
});

test("status false prints the not-signed-in guidance (await is inside the ternary)", async () => {
  const c = capture();
  try {
    // A bare Promise is always truthy; getting this branch proves run() awaits status() first.
    await run(["node", "cli.js", "status"], allSpies({ status: async () => false }));
  } finally { c.restore(); }
  assert.ok(c.out().includes("Not signed in — run `node scripts/cli.js login`."), "prints the login guidance");
});

// --- login -------------------------------------------------------------------
test("login true prints 'Signed in. ✓'", async () => {
  const c = capture();
  try {
    await run(["node", "cli.js", "login"], allSpies({ login: async () => true }));
  } finally { c.restore(); }
  assert.strictEqual(c.out(), "Signed in. ✓");
});

test("login false prints 'Login not detected — try again.'", async () => {
  const c = capture();
  try {
    await run(["node", "cli.js", "login"], allSpies({ login: async () => false }));
  } finally { c.restore(); }
  assert.ok(c.out().includes("Login not detected — try again."), "prints the retry guidance");
});

// --- decompose / harvest (identical dispatch: success prints the template + passes (a1,a2);
// missing a1 falls through to USAGE via the shared `&& a1` guard) ---------------
for (const [cmd, a1, a2, r] of [
  ["decompose", "img.png", "out/x", { count: 3, outDir: "out/x", designId: "DX" }],
  ["harvest", "DAH", "out/DAH", { count: 40, outDir: "out/DAH", designId: "DAH" }],
]) {
  test(`${cmd} success prints '✓ N layers -> dir' + design line and passes (a1,a2)`, async () => {
    const c = capture();
    const handler = spy(r);
    try {
      await run(["node", "cli.js", cmd, a1, a2], allSpies({ [cmd]: handler }));
    } finally { c.restore(); }
    assert.ok(c.out().includes(`✓ ${r.count} layers -> ${r.outDir}`), "prints the layer count line");
    assert.ok(c.out().includes(`design: ${r.designId}`), "prints the design id line");
    assert.deepStrictEqual(handler.calls, [[a1, a2]], `${cmd} called with (a1, a2) positionally`);
  });

  test(`${cmd} without a1 falls through to USAGE (locks the \`&& a1\` guard)`, async () => {
    const c = capture();
    const handler = spy({ count: 9, outDir: "nope", designId: "NOPE" });
    try {
      await run(["node", "cli.js", cmd], allSpies({ [cmd]: handler }));
    } finally { c.restore(); }
    assert.strictEqual(handler.calls.length, 0, `${cmd} handler not called without a1`);
    assert.ok(c.out().includes("canva-magic-layers"), "prints USAGE instead");
  });
}

// --- doctor: self-check report -----------------------------------------------
test("doctor prints a per-check report and a 'Ready' line when Node+Chrome+session all pass", async () => {
  const c = capture();
  const deps = allSpies();
  try { await run(["node", "cli.js", "doctor"], deps); } finally { c.restore(); }
  assert.strictEqual(deps.doctor.calls.length, 1, "doctor handler called");
  assert.ok(/Node 22\.0\.0 .*✓/.test(c.out()), "reports the Node check");
  assert.ok(/Chrome \/x\/chrome ✓/.test(c.out()), "reports the resolved Chrome path");
  assert.ok(/Signed in to Canva ✓/.test(c.out()), "reports the session check");
  assert.ok(c.out().includes("Ready."), "summarises Ready when all checks pass");
});

test("doctor summarises 'Not ready' and marks the failing check when the session is missing", async () => {
  const c = capture();
  const deps = allSpies({ doctor: spy({ node: "22.0.0", nodeOk: true, chrome: "/x/chrome", signedIn: false }) });
  try { await run(["node", "cli.js", "doctor"], deps); } finally { c.restore(); }
  assert.ok(/Signed in to Canva ✗/.test(c.out()), "marks the missing session with ✗");
  assert.ok(c.out().includes("Not ready"), "summarises Not ready");
});

test("doctor marks the session check '?' (undetermined) when no Chrome was found", async () => {
  const c = capture();
  const deps = allSpies({ doctor: spy({ node: "22.0.0", nodeOk: true, chrome: null, signedIn: null }) });
  try { await run(["node", "cli.js", "doctor"], deps); } finally { c.restore(); }
  assert.ok(/Chrome not found ✗/.test(c.out()), "reports Chrome not found");
  assert.ok(/Signed in to Canva \?/.test(c.out()), "session is undetermined (null) without a browser");
});

// --- error boundary + non-zero exit -----------------------------------------
test("a thrown handler error prints '✗ <message>' on stderr and sets exit code 1", async () => {
  const c = capture();
  try {
    await run(["node", "cli.js", "status"], allSpies({ status: async () => { throw new Error("NOAUTH boom"); } }));
  } finally { c.restore(); }
  assert.strictEqual(c.err(), "✗ NOAUTH boom", "error prefixed with '✗ ' on stderr");
  assert.strictEqual(c.out(), "", "nothing written to stdout on failure");
  assert.strictEqual(process.exitCode, 1, "process.exitCode set to 1 on failure");
});
