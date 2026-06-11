<div align="center">

# 🎨 Canva Magic Layers

### Photo in → every editable layer out.

Turn one flat image into a stack of editable, full-resolution **transparent-PNG layers** —<br>
each object cut out, the background **AI-inpainted** back in — straight from your coding agent.

Needs only **Node 22+** and **Chrome / Edge / Brave** — no `npm install`, no API keys.

![Node](https://img.shields.io/badge/Node-%E2%89%A5%2022-339933?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-success)
![Platforms](https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-informational)
[![Agent Skill](https://img.shields.io/badge/Agent%20Skill-agentskills.io-7C3AED)](https://agentskills.io)

</div>

---

## ⚡ Install

Paste this into your coding agent — **Claude Code**, **Codex**, or any other:

```
Install this skill: https://github.com/brianbell-x/canva-magic-layers
```

It clones the skill, asks where to put it, and walks you through the one-time Canva sign-in
(a Canva **Pro/Teams** account). Then just say:

> *"decompose ./poster.png into layers"*

---

## 🤖 Instructions for agents

If you are an AI agent installing this for a user:

1. **Ask where to install it** — Personal/Global (available in every project) or
   Project-scoped (this repository only).
2. **Copy this skill** into the matching folder — named `canva-magic-layers` with
   `SKILL.md` at its top (don't nest it deeper):

   | Agent | Personal / Global | Project-scoped |
   | :-- | :-- | :-- |
   | **Claude Code** | `~/.claude/skills/canva-magic-layers/` | `.claude/skills/canva-magic-layers/` |
   | **All others** (`.agents`) | `~/.agents/skills/canva-magic-layers/` | `.agents/skills/canva-magic-layers/` |

3. **Finish setup** — have the user run `node scripts/cli.js login` once (the only human
   step), then confirm with `node scripts/cli.js doctor`.
