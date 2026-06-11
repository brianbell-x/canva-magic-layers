// Canva Magic Layers, zero npm dependencies, Win/Mac/Linux.
// Canva sits behind Cloudflare, which blocks Node fetch and headless Chrome — so every
// /_ajax/ call runs IN-PAGE in a headed real Chrome driven over CDP (see chrome.js);
// Node only downloads the resulting public media.canva.com PNGs. Auth = the persistent
// Chrome profile (login once). No cookie file, no API keys.
const fs = require("fs");
const path = require("path");
const chrome = require("./chrome");

const HOME = "https://www.canva.com";
const NOAUTH = "Not signed in to Canva (or session expired). Run `node scripts/cli.js login` once.";
const sleep = chrome.sleep;

const designIdFrom = (s) => {
  const m = String(s).match(/\/design\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{6,}$/.test(s) ? s : null);
};

// Real auth check. Cookie presence LIES: a stale CID/CUI/CAZ jar survives session expiry,
// so it can't tell signed-in from expired (the bug that masked an expired session). Read the
// render instead, and require a POSITIVE signed-in marker (an authed-only nav/account
// affordance) AND the absence of a "Log in"/"Sign up" control — so a logged-out page that's
// still hydrating (no control rendered yet) is not mistaken for signed-in.
const AUTHED_JS = `(()=>{try{const t=(document.body&&document.body.innerText)||"";if(t.length<40)return false;
  const ctrls=[...document.querySelectorAll('a,button,[role=button],[type=submit]')];
  if(ctrls.some(e=>/^(log\\s?in|sign\\s?up)$/i.test(((e.textContent)||"").trim())))return false;
  return !!document.querySelector('a[href*="/settings"],a[href*="/folder"],[aria-label*="account" i],[aria-label*="notification" i]')
    ||ctrls.some(e=>/^create a design$/i.test(((e.textContent)||"").trim()));}catch(e){return false;}})()`;
const isAuthed = (page) => page.evaluate(AUTHED_JS).then((v) => v === true).catch(() => false);

// Canva's cookie-consent banner overlays the app and BLOCKS the signed-in markers from
// rendering — which makes the auth check false-negative (so login could never detect a
// real sign-in). Dismiss it, privacy-preserving: reject non-essential cookies.
const DISMISS_COOKIES_JS = `(()=>{const btns=[...document.querySelectorAll('button,[role=button]')];
  const b=btns.find(e=>/^(reject all cookies|reject all|only essential|decline optional|decline)$/i.test(((e.textContent)||"").trim()));
  if(b){b.click();return true;}return false;})()`;
const dismissCookies = (page) => page.evaluate(DISMISS_COOKIES_JS).catch(() => false);

// In-page harvester: document tree -> media refs -> public PNG URLs. Runs in the page so
// Canva's own session + Chrome's TLS satisfy Cloudflare. Returns { refs, layers, doc }.
const harvestJS = (id) =>
  `(async()=>{const S=t=>t.replace(/^.*?\\/\\//s,'');` +
  `const d=S(await (await fetch('/_ajax/documents/${id}',{credentials:'include'})).text());` +
  `const refs=[...new Set(d.match(/MA[A-Za-z0-9_-]{8,12}/g)||[])];const out=[];` +
  `for(let i=0;i<refs.length;i+=20){const b=refs.slice(i,i+20);` +
  `const q=b.map(r=>'refs='+encodeURIComponent(r+':1')).join('&');` +
  `const u='/_ajax/media?batch&'+q+'&projection=FS&qualities=SCREEN_3X&documentId=${id}&ignoreForbidden&includeRetained';` +
  `const bo=S(await (await fetch(u,{credentials:'include'})).text());` +
  `const m=bo.match(/https:\\/\\/media\\.canva\\.com\\/[^"\\\\]+/g)||[];` +
  `b.forEach((r,j)=>{if(m[j])out.push({ref:r,url:m[j]});});}` +
  `return {refs,layers:out,doc:d};})()`;

async function harvestPage(page, id) {
  const r = await page.evaluate(harvestJS(id)).catch(() => null);
  return Array.isArray(r?.refs) ? r : { refs: [], layers: [], doc: "" };
}

async function waitForLayers(page, id, { timeout = 90000, min = 1 } = {}) {
  const start = Date.now();
  let last = -1, stable = 0;
  while (Date.now() - start < timeout) {
    const n = (await harvestPage(page, id)).refs.length;
    if (n >= min && n === last) { if (++stable >= 2) return n; } else stable = 0;
    last = n;
    await sleep(2500);
  }
  return Math.max(last, 0);
}

// Layer PNG URLs are public — plain Node fetch, no Cloudflare, no auth.
async function save(layers, doc, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  if (doc) fs.writeFileSync(path.join(outDir, "document.json"), doc);
  const manifest = [];
  for (let i = 0; i < layers.length; i++) {
    const buf = Buffer.from(await (await fetch(layers[i].url)).arrayBuffer());
    const file = `layer_${String(i + 1).padStart(2, "0")}_${layers[i].ref}.png`;
    fs.writeFileSync(path.join(outDir, file), buf);
    manifest.push({ index: i + 1, ref: layers[i].ref, file, bytes: buf.length });
  }
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

// Pull every layer from a design that is ALREADY split by Magic Layers.
async function harvest(urlOrId, outDir) {
  const id = designIdFrom(urlOrId);
  if (!id) throw new Error("Could not parse a design id from: " + urlOrId);
  outDir = outDir || path.join("out", id);
  const s = await chrome.launch({ offscreen: process.env.HEADED !== "1", profile: chrome.PROFILE, startUrl: `${HOME}/design/${id}/edit` });
  try {
    await waitForLayers(s.page, id, {});
    const { layers, doc } = await harvestPage(s.page, id);
    if (!layers.length) throw new Error("No layers found — has Magic Layers been run on this design? (or " + NOAUTH + ")");
    const manifest = await save(layers, doc, outDir);
    return { designId: id, count: manifest.length, outDir };
  } finally { await s.close(); }
}

// In-page click by accessible name (aria-label or text). The editor's controls are React
// buttons keyed by their accessible name, so an anchored regex addresses them precisely.
const clickJS = (re) => `(()=>{const rx=${re.toString()};const el=[...document.querySelectorAll('button,[role=button],[role=menuitem],[role=tab],[aria-label]')]
  .find(e=>rx.test(((e.getAttribute('aria-label')||e.textContent)||'').trim()));if(el){el.click();return true;}return false;})()`;
const existsJS = (re) => `!![...document.querySelectorAll('button,[role=button],[role=menuitem],[role=tab],[aria-label]')]
  .find(e=>${re.toString()}.test(((e.getAttribute('aria-label')||e.textContent)||'').trim()))`;

// Full hands-off flow (no human after the one-time login): open a blank editor, upload the
// photo into it, place it, run Magic Layers, and harvest the result. createToolJob can't be
// called directly — it needs a signed media token + element/design context that only exist
// once the image is placed in an editor — so we drive Canva's own editor, which mints all of
// it. The async AI job (~30-90s) rebuilds the image IN PLACE as N layered media refs in this
// same design; we read the job's result straight off the wire (success/error + Canva's own
// message, e.g. an image-too-small rejection) and then harvest the layers.
async function decompose(imagePath, outDir) {
  imagePath = path.resolve(imagePath);
  if (!fs.existsSync(imagePath)) throw new Error("Image not found: " + imagePath);
  const filename = path.basename(imagePath);
  outDir = outDir || path.join("out", path.parse(imagePath).name);
  const s = await chrome.launch({ offscreen: process.env.HEADED !== "1", profile: chrome.PROFILE, startUrl: HOME + "/design/play" });
  const page = s.page, cdp = s.cdp, sid = page.sessionId;

  // One capture for the whole run: the upload's native file chooser + the minted media ref,
  // and the Magic Layers job result. createToolJob/getToolJobResult are issued from a Web
  // Worker, so auto-attach to it and enable Network there too. The result's discriminator
  // ("A?":"A" done / "B" error / "C" processing) is decisive; on error it carries Canva's
  // message (the "A" field), which we surface verbatim.
  const dbg = process.env.DECOMPOSE_DEBUG ? (...a) => process.stdout.write("[decompose] " + a.join(" ") + "\n") : () => {};
  let chooser = null, uploadedRef = null, capturing = false, job = null;
  const jobReqs = new Set();
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
  const base = cdp.ws.onmessage;
  cdp.ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return base(ev); }
    try {
      if (m.method === "Page.fileChooserOpened") chooser = m.params;
      if (m.method === "Target.attachedToTarget") cdp.send("Network.enable", {}, m.params.sessionId).catch(() => {});
      if (capturing && m.method === "Network.requestWillBeSent") { const h = (m.params.request.url.match(/\/_ajax\/media\/(MA[A-Za-z0-9_-]+)/) || [])[1]; if (h && !uploadedRef) uploadedRef = h; }
      if (m.method === "Network.responseReceived" && /getToolJobResult/.test(m.params.response.url)) jobReqs.add(m.params.requestId);
      if (m.method === "Network.loadingFinished" && jobReqs.has(m.params.requestId))
        cdp.send("Network.getResponseBody", { requestId: m.params.requestId }, m.sessionId).then(({ body }) => {
          dbg("jobResult body:", (body || "").slice(0, 300).replace(/\n/g, " "));
          const d = (body.match(/"A\?":"([ABC])"/) || [])[1];
          if (d === "A") job = { done: true };
          else if (d === "B") job = { error: (body.match(/"A":"([^"]+)"/) || [])[1] || "Magic Layers failed" };
        }).catch((e) => dbg("getResponseBody fail:", e.message));
    } catch {}
    base(ev);
  };

  try {
    await sleep(2000); await dismissCookies(page);

    // 1. Open a blank editor (Canva mints a fresh design we run Magic Layers in). A
    //    logged-out profile is redirected to /login — fail fast and clearly on that.
    let id = null;
    for (let i = 0; i < 45 && !id; i++) {
      await sleep(2000);
      const href = await page.evaluate("location.href").catch(() => "");
      if (/canva\.com\/(login|signup|log_?in|sign_?up)(\/|\?|$)/i.test(href)) throw new Error(NOAUTH);
      await page.evaluate(clickJS(/^(Close|Skip|Got it|Maybe later|Start designing)$/i)).catch(() => {});
      const mm = href.match(/\/design\/([A-Za-z0-9_-]{6,})\//);
      if (mm && (await page.evaluate(existsJS(/^uploads?$/i)).catch(() => false))) id = mm[1];
    }
    if (!id) throw new Error("Could not open a blank editor (UI changed, or " + NOAUTH + ").");

    // 2. Upload the photo into the editor's Uploads panel (mints the media + signed token).
    //    The "Upload files" click must carry a user gesture — browsers suppress the native
    //    file dialog for a programmatic <input type=file> click that lacks user activation.
    await page.evaluate(clickJS(/^uploads?$/i)).catch(() => {});
    for (let i = 0; i < 16 && !(await page.evaluate(existsJS(/^upload files$/i)).catch(() => false)); i++) await sleep(1000);
    await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true }, sid);
    capturing = true;
    await cdp.send("Runtime.evaluate", { expression: `(()=>{const el=[...document.querySelectorAll('button,[role=button]')].find(e=>/^upload files$/i.test(((e.getAttribute('aria-label')||e.textContent)||'').trim()));if(el)el.click();})()`, userGesture: true, awaitPromise: true }, sid).catch(() => {});
    for (let i = 0; i < 20 && !chooser; i++) await sleep(500);
    if (!chooser) throw new Error("The Upload control did not open a file chooser (UI changed).");
    await cdp.send("DOM.setFileInputFiles", { files: [imagePath], backendNodeId: chooser.backendNodeId }, sid);
    for (let i = 0; i < 90 && !uploadedRef; i++) await sleep(1000);
    if (!uploadedRef) throw new Error("Upload did not mint a media ref (UI changed, or " + NOAUTH + ").");
    await cdp.send("Page.setInterceptFileChooserDialog", { enabled: false }, sid).catch(() => {});
    await sleep(4000); // let the thumbnail render in the panel

    // 3. Place the just-uploaded image (newest, first match by filename) onto the canvas.
    let placed = false;
    for (let i = 0; i < 25 && !placed; i++) {
      placed = await page.evaluate(`(()=>{const el=[...document.querySelectorAll('[role=button][aria-label]')].find(e=>(e.getAttribute('aria-label')||'')===${JSON.stringify(filename)}&&e.getBoundingClientRect().width>40);if(!el)return false;const r=el.getBoundingClientRect();['pointerdown','mousedown','mouseup','click'].forEach(t=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2})));return true;})()`).catch(() => false);
      if (!placed) await sleep(1500);
    }
    if (!placed) throw new Error("Could not place the uploaded image on the canvas (UI changed).");
    await sleep(4000);

    // 4. With the image selected, Edit image -> Magic Layers (fires the async AI job).
    await page.evaluate(clickJS(/^edit( image| photo)?$/i)).catch(() => {});
    await sleep(2500);
    if (!(await page.evaluate(clickJS(/^magic layers$/i)).catch(() => false)))
      throw new Error("Could not find the Magic Layers control on the selected image (UI changed).");

    // 5. Wait for the result, then harvest. The AI job runs async (~30-90s) and the editor
    //    then AUTOSAVES the rebuilt layers into the design's saved document — and that
    //    autosave LAGS the job by up to a minute. The doc endpoint reads the SAVED state, so
    //    we poll it (not just the job signal) until the layers actually persist as >=2 media
    //    refs. A job error (e.g. an image-too-small rejection) carries Canva's own message
    //    and fails fast.
    const start = Date.now();
    let layers = [], doc = "";
    while (Date.now() - start < 240000) {
      if (job && job.error) throw new Error("Magic Layers: " + job.error);
      const h = await harvestPage(page, id);
      dbg(`+${Math.round((Date.now() - start) / 1000)}s layers=${h.layers.length} job=${job ? JSON.stringify(job) : "null"}`);
      if (h.layers.length >= 2) { layers = h.layers; doc = h.doc; break; }
      await sleep(3000);
    }
    if (layers.length < 2) throw new Error(job && job.error ? "Magic Layers: " + job.error : "Magic Layers produced no layers (job failed or timed out).");
    const manifest = await save(layers, doc, outDir);
    return { designId: id, count: manifest.length, outDir };
  } finally { cdp.ws.onmessage = base; await s.close(); }
}

// Human step: sign in once. We wait for the page to actually render signed-in (NOT for
// cookies to appear — stale cookies would auto-close before you ever sign in), then close.
async function login() {
  const s = await chrome.launch({ headless: false, profile: chrome.PROFILE, startUrl: HOME + "/login" });
  try {
    process.stdout.write("A Chrome window opened — sign in to Canva. I'll detect it and close the window automatically...\n");
    const start = Date.now();
    while (Date.now() - start < 300000) {
      await dismissCookies(s.page); // the consent banner blocks the signed-in markers
      if (await isAuthed(s.page)) return true;
      await sleep(2000);
    }
    return false;
  } finally { await s.close(); }
}

// Load the app and see whether it renders signed-in. Offscreen-headed (not headless) so
// the render is real and Cloudflare is satisfied; stale cookies cannot fake this.
async function status() {
  const s = await chrome.launch({ offscreen: process.env.HEADED !== "1", profile: chrome.PROFILE, startUrl: HOME + "/" });
  try { await sleep(3000); await dismissCookies(s.page); await sleep(2000); return await isAuthed(s.page); }
  finally { await s.close(); }
}

// Self-check behind the `doctor` command: Node version, an installed Chrome, and whether the
// saved session is live. signedIn is tri-state: true / false / null = undetermined — we only
// probe when a browser exists, and a launch failure (e.g. profile already in use) leaves it
// undetermined rather than aborting the whole report.
async function doctor() {
  const node = process.versions.node;
  const nodeOk = Number(node.split(".")[0]) >= 22;
  let chromePath = null; try { chromePath = chrome.findChrome(); } catch {}
  let signedIn = null; if (chromePath) { try { signedIn = await status(); } catch {} }
  return { node, nodeOk, chrome: chromePath, signedIn };
}

module.exports = { decompose, harvest, login, status, doctor, designIdFrom, AUTHED_JS, isAuthed, DISMISS_COOKIES_JS, dismissCookies, harvestJS, harvestPage, waitForLayers, save, clickJS, existsJS };
