---
name: canva-magic-layers
description: Split a flat image into separate editable layers — each object as its own transparent PNG plus the AI-filled background. Use to get the layers/elements out of a mockup or AI-generated composite, or to make an image's pieces individually editable.
---

# Canva Magic Layers

Turn one flat image into separate transparent-PNG layers via a signed-in Canva session. Zero dependencies — needs only Node 22+ and Google Chrome (or Edge/Brave). Runs on Windows/Mac/Linux. Run everything from this skill's own directory (where `SKILL.md` and `cli.js` live).

Setup (first time): `node cli.js login` — opens Chrome to sign in to Canva. **login needs a human; you can't do it.** Needs a Canva Pro account. Check anytime with `node cli.js status`.

Then pick one:
- Image file → `node cli.js decompose <imagePath> [outDir]` — opens an editor, uploads it, runs Magic Layers, saves the layers
- Canva design already split with Magic Layers → `node cli.js harvest <urlOrId> [outDir]`

`decompose` is fully hands-off after the one-time login — no human in the loop. Use a **reasonably high-resolution** PNG/JPG: Magic Layers rejects small images, and `decompose` then reports Canva's "too small" message. Only have a design id/URL that isn't split yet? `harvest` finds no layers — run `decompose` on the source image instead.

Output → `outDir` (default `out/<name>`): `layer_NN_*.png` + `manifest.json`. `Not signed in` means setup isn't done. Reference: README.md.
