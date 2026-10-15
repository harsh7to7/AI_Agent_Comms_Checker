# DESS Comms Checker

An AI agent that checks parent messages against the **Communication Checker Guidelines (21.9.26)** and returns a refined, ready-to-submit version before it goes to the Communication Request Form.

## How it works

```
Draft (.docx or pasted)
   │
   ├─ 1. Rule engine ──────── 60+ deterministic checks (dates, times, names, spacing, links,
   │                          money, caps, British English, merge fields, Montserrat/black/size,
   │                          48h notice, Friday sends, archive date)
   │
   ├─ 2. Claude (AI editor) ─ guidelines + the comms team's before/after examples + rule findings
   │                          → issues list, refined title/description/body, questions for sender
   │
   ├─ 3. Verify loop ──────── safe auto-fixes, then the rule engine re-checks the AI's version;
   │                          any remaining text errors go back to Claude (up to 2 rounds)
   │
   └─ Result: refined message, change diff, issue list, manual checklist, .docx in the template
```

Without an API key, steps 1 and 3 still run (rule checks + safe automatic fixes).

## Setup

```bash
npm install
cp .env.example .env      # then add ANTHROPIC_API_KEY=...
npm start                 # http://localhost:3000
```

## Use

**Web app** – upload the Word template (or paste the text), choose school, audience, send and archive dates, then click **Check & refine**. You get:
- **Refined message** – preview, *Show changes* diff, copy, download as .docx (Montserrat 10pt, black)
- **Issues** – what the AI changed and why, plus every guideline check with its rule number
- **Before you submit** – things that can't be automated (SLT approval, links tested in incognito, parent calendar…)

**Command line**

```bash
node cli.js "draft.docx" --school oud-metha --audience year-group --send 2026-10-20 --archive 2026-10-29 --out refined.docx
node cli.js "draft.docx" --no-ai      # rules + auto-fixes only
node cli.js "draft.docx" --json       # machine-readable output
```

Schools: `oud-metha`, `academic-city`, `college`, `all`. Audience: `whole-school`, `year-group`, `class`, `selected`.

## Teaching it more house style

Put pairs of files in `examples/` named `<name> - version 1.docx` (original draft) and `<name> - version 2.docx` (the comms team's edit). They are loaded automatically into the AI's instructions.

## Updating the guidelines

- Guideline text the AI follows: `src/guidelines.js`
- Automated rules: `src/rules.js`, `src/dates.js` (each issue references its guideline number, e.g. G27)
- Safe automatic fixes: `src/autofix.js`

Run `npm test` after changing rules. The tests check the engine against the real examples.
