# Troubleshooting & how it works

## How it works (and why it needs a real browser)

Canva has no public Magic Layers API, and `canva.com/_ajax/` sits behind Cloudflare — Node's `fetch` and headless Chrome both get challenged. So the skill drives a **real, headed Chrome** (positioned off-screen so it isn't intrusive) over the DevTools Protocol: it opens Canva's own editor, uploads the image, runs Magic Layers, reads the job result off the wire, and waits for the editor to autosave the rebuilt layers. Node then downloads only the finished, public `media.canva.com` PNGs — those need no auth.

Auth is the persistent Chrome profile at `~/.canva-magic-layers-profile`: log in once and it **is** the credential. No API keys, no cookie files. `status`/`doctor` check the live rendered page (not cookie presence), so a stale session can't fake a sign-in.

## Common failures

- **"Not signed in to Canva"** — the session expired or login was never done. Run `node scripts/cli.js login` (human step), then confirm with `node scripts/cli.js doctor`.
- **"This image is too small for this action"** (surfaced verbatim) — Magic Layers needs a higher-resolution input. Use a larger PNG/JPG.
- **`harvest` finds no layers** — the design hasn't been split by Magic Layers yet. Run `decompose` on the source image instead.
- **`login` opens but never detects sign-in** — don't use Google SSO (Google blocks automated browsers); sign in with Canva email / magic-link. The cookie-consent banner is dismissed automatically.
- **"No Chrome/Edge/Brave found"** — install one, or set `CANVA_CHROME=<path-to-executable>`.
- **Want to watch it run** — set `HEADED=1` to show the browser window instead of running it off-screen. Set `PROFILE=<dir>` to use a different profile.

## Limits

- Best on graphic designs / illustrations / mockups; photo-realistic photos may split into fewer layers (subject + background).
- The AI job takes ~30–90s and consumes the account's AI allowance.
- Automating your own Canva account may conflict with Canva's Terms — use a dedicated account and human-like pacing; review before production use.
- API-free alternative (no browser, no ToS concern): `fal-ai/qwen-image-layered` (~$0.05/run) returns N transparent layers with inpainting — lower fidelity than Canva on text/complex art.
