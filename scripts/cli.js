#!/usr/bin/env node
const USAGE = `canva-magic-layers — photo in, all editable layers out

  node scripts/cli.js doctor                      Verify the install: Node, Chrome, and the saved session
  node scripts/cli.js login                       Sign in to Canva once (opens Chrome; human step)
  node scripts/cli.js status                      Check whether the saved session works
  node scripts/cli.js decompose <image> [outDir]  Image -> run Magic Layers -> save every layer
  node scripts/cli.js harvest <urlOrId> [outDir]  Save every layer from an already-split design

Env: CANVA_CHROME=<browser path>  HEADED=1 (show the browser window)  PROFILE=<dir>`;

// A pass/fail line for one doctor check; "?" when we couldn't determine it (e.g. Chrome missing).
const mark = (ok) => (ok === null ? "?" : ok ? "✓" : "✗");

async function run(argv, deps = require("./canva")) {
  const [cmd, a1, a2] = argv.slice(2);
  const { login, status, doctor } = deps;
  try {
    if (cmd === "doctor") {
      const d = await doctor();
      console.log(`Node ${d.node} (>=22) ${mark(d.nodeOk)}\nChrome ${d.chrome || "not found"} ${mark(!!d.chrome)}\nSigned in to Canva ${mark(d.signedIn)}`);
      console.log(d.nodeOk && d.chrome && d.signedIn ? "\nReady. Run `node scripts/cli.js decompose <image>`." : "\nNot ready — fix the ✗/? above (sign in with `node scripts/cli.js login`).");
    }
    else if (cmd === "status") console.log((await status()) ? "Signed in to Canva. ✓" : "Not signed in — run `node scripts/cli.js login`.");
    else if (cmd === "login") console.log((await login()) ? "Signed in. ✓" : "Login not detected — try again.");
    else if ((cmd === "decompose" || cmd === "harvest") && a1) { const r = await deps[cmd](a1, a2); console.log(`✓ ${r.count} layers -> ${r.outDir}\n  design: ${r.designId}`); }
    else console.log(USAGE);
  } catch (e) {
    console.error("✗ " + e.message);
    process.exitCode = 1;
  }
}

module.exports = { run, USAGE };
if (require.main === module) run(process.argv);
