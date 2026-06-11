---
name: canva-magic-layers
description: Split a flat image into separate editable layers — each object as its own transparent PNG plus the AI-filled background — using Canva's Magic Layers. Use to extract the layers/elements from a mockup, poster, or AI-generated composite, or to make a flat image's pieces individually editable. Runs hands-off after a one-time human login.
compatibility: Requires Node 22+, an installed Chrome/Edge/Brave, network access, and a Canva Pro/Teams account.
allowed-tools: Bash(node:*) Read
metadata:
  version: "3.0.0"
  homepage: "https://github.com/brianbell-x/canva-magic-layers"
---

# Canva Magic Layers

Turn one flat image into separate transparent-PNG layers — each object cut out, plus the AI-inpainted background — by driving a signed-in Canva session. Zero dependencies: just Node 22+ and Chrome. Run every command from this skill's own directory (the folder holding this `SKILL.md`).

## First run (once)

1. `node scripts/cli.js doctor` — checks Node, Chrome, and the saved session in one shot.
2. If it reports not signed in: `node scripts/cli.js login` — opens Chrome to sign in. **This needs a human; you cannot do it.** Sign in with Canva email / magic-link, not Google SSO. Needs a Canva Pro/Teams account.

## Use

- Flat image → layers: `node scripts/cli.js decompose <imagePath> [outDir]`
- A Canva design **already** split by Magic Layers → `node scripts/cli.js harvest <urlOrId> [outDir]`

Both run hands-off (no human after login) and print JSON with the resolved `outDir`, `count`, and `designId`. `outDir` defaults to `out/<name>` and holds `layer_NN_<ref>.png` (each layer), `manifest.json`, and `document.json`. Read the PNGs from there.

## Know this

- Use a reasonably **high-resolution** PNG/JPG. Magic Layers rejects small images; `decompose` then surfaces Canva's own "too small" message rather than failing silently.
- The AI job takes ~30–90s, but the full `decompose` command can run ~2–3 min (Canva's autosave of the layers lags the job) — don't treat it as stuck before then. It uses the account's AI allowance.
- `Not signed in` → setup isn't done; run `login`. Have a design id that isn't split yet? `harvest` finds no layers — run `decompose` on the source image instead.
- More failure modes and how it works under the hood: [references/troubleshooting.md](references/troubleshooting.md).
