# Canva Magic Layers

**Fastest install — paste this into your coding agent:**

```
Install this skill: https://github.com/brianbell-x/canva-magic-layers
```

**Photo in → every editable layer out.** Exposes Canva's *Magic Layers* — which
rebuilds one flat image into a multi-layer design, AI-inpainting what sits behind
each layer — to your coding agent, fully hands-off after a one-time login.

From one image it produces, in `outDir`:
- `layer_NN_<ref>.png` — each layer as a full-resolution **transparent-PNG cutout**
- `document.json` — the Canva design tree (element positions, z-order, types)
- `manifest.json` — index of layers with refs and byte sizes

**Zero npm dependencies, identical on Windows / macOS / Linux.** Needs only
**Node 22+** and an installed **Chrome / Edge / Brave** — no browser bundled or
downloaded, no `npm install`.

## It's an Agent Skill

This repo is an [Agent Skill](https://agentskills.io) — the open `SKILL.md` standard
adopted by Claude Code, OpenAI Codex, Cursor, GitHub Copilot, Goose, Gemini CLI, and
more. Install it by cloning the repo into your agent's skills directory:

```bash
# Claude Code
git clone https://github.com/brianbell-x/canva-magic-layers ~/.claude/skills/canva-magic-layers
# All others (.agents ecosystem)
git clone https://github.com/brianbell-x/canva-magic-layers ~/.agents/skills/canva-magic-layers
```

Project-scoped works too (`.claude/skills/…` for Claude Code, `.agents/skills/…` for
all others). The folder must contain `SKILL.md` at its top — don't nest it deeper. Your agent then discovers the
skill from its description and runs the CLI itself. **Any other agent:** point it at
`SKILL.md` and let it run the commands below — no skill runtime required, just a shell.

Then do the one-time setup and verify it works:

```bash
node scripts/cli.js doctor   # checks Node, Chrome, and the saved session
node scripts/cli.js login    # opens Chrome — sign in once (the only human step)
```

## Installation instructions for agents

If you are an AI agent setting this up for a user, install it as a skill — don't just run it ad hoc:

1. **Ask the user where to install it:** Personal/Global (available in every project) or Project-scoped (this repository only).
2. **Copy this skill** into the matching location below, as a folder named `canva-magic-layers` with `SKILL.md` at its top (don't nest it deeper):

   | Agent | Personal / Global | Project-scoped |
   | --- | --- | --- |
   | Claude Code | `~/.claude/skills/canva-magic-layers/` | `.claude/skills/canva-magic-layers/` |
   | All others (`.agents` ecosystem) | `~/.agents/skills/canva-magic-layers/` | `.agents/skills/canva-magic-layers/` |

3. **Finish setup:** have the user run `node scripts/cli.js login` once (the only human step), then confirm with `node scripts/cli.js doctor`.

## Sign in (one-time)

Login is the only human step: it establishes the session in a persistent Chrome profile
(`~/.canva-magic-layers-profile`), which **is** the credential — no API keys, no cookie
files. Sign in with Canva email / magic-link rather than Google SSO (Google blocks
automated browsers). A Canva **Pro/Teams** account is recommended (transparent export and
the feature are gated). The session lasts a while; `doctor`/`status` tell you when to
re-run `login`.

## Use it (CLI)

```bash
node scripts/cli.js doctor                          # verify the install (Node + Chrome + session)
node scripts/cli.js decompose path/to/photo.png [outDir]   # image -> layers (hands-off)
node scripts/cli.js harvest <designUrlOrId> [outDir]        # layers from an already-split design
```

`decompose` is fully autonomous after login — it opens an editor, uploads the image,
runs Magic Layers, and saves every layer. `harvest` is the fallback when a design has
already been split and you just want its layers. Both print JSON with the resolved
`outDir`, `count`, and `designId`; `outDir` defaults to `out/<name>`.

Env: `CANVA_CHROME=<path>` (force a browser binary), `HEADED=1` (show the browser
instead of running it off-screen), `PROFILE=<dir>`. Installed globally (`npm i -g .`)
you also get a `canva-magic-layers` command, e.g. `canva-magic-layers decompose photo.png`.

## Tests

```bash
npm test     # node --test — runs anywhere, no Chrome or Canva login needed
```

Offline tests mock the browser/network and pass on any machine. Live end-to-end checks
are gated and skipped by default; unlock with `CANVA_LIVE=1` plus
`CANVA_TEST_DESIGN=<url-or-id>` for harvest, or
`CANVA_FULL=1 CANVA_TEST_IMAGE=<path-to-high-res-image>` for decompose.

## Notes & limits

- Input: a single **PNG/JPG**. Magic Layers needs a **reasonably high-resolution**
  image — it rejects small ones; on a too-small input `decompose` surfaces Canva's own
  "too small" message rather than failing silently.
- Magic Layers is an async AI job (~30-90s) and consumes the account's AI allowance. The
  full `decompose` command can take a couple of minutes — Canva's autosave of the rebuilt
  layers lags the job — so it isn't stuck if it runs past 90s.
- Best on graphic designs / illustrations / mockups; photo-realistic photos may split
  into fewer layers (subject + background).
- Automating your own Canva account may conflict with Canva's Terms — use a dedicated
  account and human-like pacing; review before production use.
- How it works under the hood, more failure modes, and an API-free alternative:
  [references/troubleshooting.md](references/troubleshooting.md).
