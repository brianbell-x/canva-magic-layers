# Canva Magic Layers

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

## Give it to your agent

It ships as an **MCP server** (works with any MCP-speaking agent) and as a plain
**CLI** (works with any agent that has a shell). Pick whichever your agent supports —
both expose the same four tools: `decompose`, `harvest`, `status`, `login`.

Use the **absolute path** to `mcp.js` in this repo. On Windows write it with forward
slashes (e.g. `C:/dev/canva-skill/mcp.js`).

**Claude Code** — one command, or commit a `.mcp.json`:
```bash
claude mcp add canva-magic-layers -- node /path/to/canva-skill/mcp.js
```
```json
{ "mcpServers": { "canva-magic-layers": {
  "command": "node", "args": ["/path/to/canva-skill/mcp.js"] } } }
```

**OpenAI Codex** — `codex mcp add`, or add to `~/.codex/config.toml`:
```bash
codex mcp add canva-magic-layers -- node /path/to/canva-skill/mcp.js
```
```toml
[mcp_servers.canva-magic-layers]
command = "node"
args = ["/path/to/canva-skill/mcp.js"]
```

**Hermes** (Nous Research) — `hermes mcp add`, or add to `~/.hermes/config.yaml`:
```yaml
mcp_servers:
  canva-magic-layers:
    command: node
    args: ["/path/to/canva-skill/mcp.js"]
```

**OpenClaw** — `openclaw mcp set`, or add to `~/.openclaw/openclaw.json` under `mcp.servers`
(a top-level `mcp` object with a `servers` map — note: not `mcpServers`):
```bash
openclaw mcp set canva-magic-layers '{"command":"node","args":["/path/to/canva-skill/mcp.js"]}'
```
```json
{ "mcp": { "servers": { "canva-magic-layers": {
  "command": "node", "args": ["/path/to/canva-skill/mcp.js"] } } } }
```

**Any other agent (CLI fallback)** — if it can run shell commands, just have it call:
```bash
node /path/to/canva-skill/cli.js decompose photo.png out/photo
```

**Claude Code as a skill** (alternative to MCP) — drop this repo into a skills folder
(`~/.claude/skills/canva-magic-layers/`); Claude auto-discovers `SKILL.md` and drives
the CLI itself.

After wiring it up, do the one-time **login** below (or let the agent call the `login`
tool). Then ask your agent things like *"decompose ./poster.png into layers"* and it
will call the tool and read the PNGs back from `outDir`. `decompose`/`harvest` return JSON
with the resolved `outDir`, `count`, and `designId`, so the agent always knows where the
layers landed — even when `outDir` is defaulted.

## Sign in (one-time)

```bash
node cli.js login     # opens Chrome — sign in once; it auto-detects and closes
node cli.js status    # check the saved session
```

Sign in with Canva email / magic-link rather than Google SSO (Google blocks automated
browsers). Login is the only human step: it establishes the session in a persistent
Chrome profile (`~/.canva-magic-layers-profile`), which **is** the credential — no API
keys, no cookie files. A Canva **Pro/Teams** account is recommended (transparent export
and the feature are gated). The session lasts a while; re-run `login` when `status`
reports signed-out.

## Use it directly (CLI)

```bash
node cli.js decompose path/to/photo.png [outDir]   # image -> layers (hands-off)
node cli.js harvest <designUrlOrId> [outDir]        # layers from an already-split design
node cli.js mcp                                      # run as an MCP server (for agents)
```

`decompose` is fully autonomous after login — it opens an editor, uploads the image,
runs Magic Layers, and saves every layer. `harvest` is the fallback when a design has
already been split and you just want its layers. `outDir` defaults to `out/<name>`.

Env: `CANVA_CHROME=<path>` (force a browser binary), `HEADED=1` (show the browser
instead of running it off-screen), `PROFILE=<dir>`.

## Tests

```bash
npm test     # node --test — runs anywhere, no Chrome or Canva login needed
```

Offline tests mock the browser/network and pass on any machine. Live end-to-end checks
are gated and skipped by default; unlock with `CANVA_LIVE=1` (plus
`CANVA_TEST_DESIGN=<url-or-id>` for harvest, `CANVA_FULL=1` for decompose).

## Notes & limits

- Input: a single **PNG/JPG**. Magic Layers needs a **reasonably high-resolution**
  image — it rejects small ones; on a too-small input `decompose` surfaces Canva's own
  "too small" message rather than failing silently.
- Magic Layers is an async AI job (~30-90s) and consumes the account's AI allowance. The
  MCP tool emits progress so long jobs don't trip your client's tool-call timeout.
- Best on graphic designs / illustrations / mockups; photo-realistic photos may split
  into fewer layers (subject + background).
- Automating your own Canva account may conflict with Canva's Terms — use a dedicated
  account and human-like pacing; review before production use.
- **API-free alternative** (no browser, no ToS concern): `fal-ai/qwen-image-layered`
  (~$0.05/run) returns N transparent layers with inpainting — lower fidelity than Canva
  on text/complex art.
