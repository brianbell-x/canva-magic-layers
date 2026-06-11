# Canva Magic Layers

**Photo in → every editable layer out.** Canva's *Magic Layers* rebuilds one flat image
into a multi-layer design — each object cut out as a full-resolution **transparent PNG**,
with whatever sat behind it **AI-inpainted** back in. This skill hands that to your coding
agent, fully hands-off after a one-time login.

Zero npm dependencies — just **Node 22+** and an installed **Chrome / Edge / Brave**.
Runs on Windows, macOS, and Linux.

## Install

Paste this into your coding agent (Claude Code, Codex, and others):

```
Install this skill: https://github.com/brianbell-x/canva-magic-layers
```

It clones the skill, asks where to put it, and walks you through the one-time Canva
sign-in (needs a Canva Pro/Teams account). Then just ask it to *"decompose ./poster.png
into layers."*

## Instructions for agents

If you are an AI agent installing this for a user:

1. **Ask where to install it:** Personal/Global (available in every project) or
   Project-scoped (this repository only).
2. **Copy this skill** into the matching folder below — named `canva-magic-layers` with
   `SKILL.md` at its top (don't nest it deeper):

   | Agent | Personal / Global | Project-scoped |
   | --- | --- | --- |
   | Claude Code | `~/.claude/skills/canva-magic-layers/` | `.claude/skills/canva-magic-layers/` |
   | All others (`.agents` ecosystem) | `~/.agents/skills/canva-magic-layers/` | `.agents/skills/canva-magic-layers/` |

3. **Finish setup:** have the user run `node scripts/cli.js login` once (the only human
   step), then confirm with `node scripts/cli.js doctor`.
