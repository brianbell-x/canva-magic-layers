#!/usr/bin/env node
const USAGE = `canva-magic-layers — photo in, all editable layers out

  node cli.js login                        Sign in to Canva once (opens Chrome; human step)
  node cli.js status                       Check whether the saved session works
  node cli.js decompose <image> [outDir]   Image -> run Magic Layers -> save every layer
  node cli.js harvest <urlOrId> [outDir]   Save every layer from an already-split design

Env: CANVA_CHROME=<browser path>  HEADED=1 (show the browser window)  PROFILE=<dir>`;

async function run(argv, deps = require("./canva")) {
  const [cmd, a1, a2] = argv.slice(2);
  const { decompose, harvest, login, status } = deps;
  try {
    if (cmd === "status") console.log((await status()) ? "Signed in to Canva. ✓" : "Not signed in — run `node cli.js login`.");
    else if (cmd === "login") console.log((await login()) ? "Signed in. ✓" : "Login not detected — try again.");
    else if (cmd === "decompose" && a1) { const r = await decompose(a1, a2); console.log(`✓ ${r.count} layers -> ${r.outDir}\n  design: ${r.designId}`); }
    else if (cmd === "harvest" && a1) { const r = await harvest(a1, a2); console.log(`✓ ${r.count} layers -> ${r.outDir}\n  design: ${r.designId}`); }
    else console.log(USAGE);
  } catch (e) {
    console.error("✗ " + e.message);
    process.exitCode = 1;
  }
}

module.exports = { run, USAGE };
if (require.main === module) run(process.argv);
