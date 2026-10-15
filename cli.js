#!/usr/bin/env node
// Usage: node cli.js <draft.docx|draft.txt> [--school oud-metha|academic-city|college|all]
//        [--audience whole-school|year-group|class|selected] [--send YYYY-MM-DD] [--archive YYYY-MM-DD]
//        [--teacher] [--no-ai] [--out refined.docx] [--json]
import './src/env.js';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { readDocx } from './src/docx-reader.js';
import { reviewMessage } from './src/agent.js';
import { buildDocx } from './src/docx-writer.js';
import { stripMarkup } from './src/markup.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    school: { type: 'string', default: 'oud-metha' },
    audience: { type: 'string', default: 'whole-school' },
    send: { type: 'string' },
    archive: { type: 'string' },
    teacher: { type: 'boolean', default: false },
    'no-ai': { type: 'boolean', default: false },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

const file = positionals[0];
if (!file) {
  console.error('Usage: node cli.js <draft.docx|draft.txt> [--school oud-metha] [--audience whole-school] [--send YYYY-MM-DD] [--archive YYYY-MM-DD] [--teacher] [--no-ai] [--out refined.docx] [--json]');
  process.exit(1);
}

let msg;
if (file.toLowerCase().endsWith('.docx')) {
  const d = await readDocx(fs.readFileSync(file));
  msg = { title: d.title, shortDescription: d.shortDescription, body: d.body, bodyMarked: d.bodyMarked, paragraphs: d.paragraphs };
} else {
  // Plain text: first line "Title: …", second "Short description: …", rest is the body.
  const text = fs.readFileSync(file, 'utf8');
  const title = text.match(/^\s*title[^:]*:\s*(.*)$/im)?.[1] || '';
  const shortDescription = text.match(/^\s*short description[^:]*:\s*(.*)$/im)?.[1] || '';
  const body = text.replace(/^\s*(title|short description)[^:]*:.*$/gim, '').replace(/^\s*body[^:\n]*:?\s*$/im, '').trim();
  msg = { title, shortDescription, body: stripMarkup(body), bodyMarked: body };
}
Object.assign(msg, { school: values.school, audience: values.audience, sendDate: values.send, archiveDate: values.archive, fromTeacher: values.teacher });

const result = await reviewMessage(msg, { useAI: !values['no-ai'], onProgress: (s) => !values.json && console.error(`… ${s}`) });

if (values.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const c = { error: '\x1b[31m', warning: '\x1b[33m', info: '\x1b[90m', suggestion: '\x1b[90m', reset: '\x1b[0m', bold: '\x1b[1m' };
  const s = result.checkSummary;
  console.log(`\n${c.bold}DRAFT CHECK${c.reset}  ${s.errors} errors · ${s.warnings} warnings · ${s.info} notes`);
  for (const i of result.checks)
    console.log(`  ${c[i.severity]}${i.severity.toUpperCase().padEnd(7)}${c.reset} [${i.guideline}] ${i.message}${i.excerpt ? `\n           "${i.excerpt}"` : ''}${i.fix ? ` → "${i.fix}"` : ''}`);
  if (result.ai) {
    console.log(`\n${c.bold}AI REVIEW${c.reset} (${result.ai.readiness})\n  ${result.ai.summary}`);
    for (const i of result.ai.issues) console.log(`  ${c[i.severity]}•${c.reset} [${i.guideline}] "${i.original}" → "${i.suggestion}" – ${i.explanation}`);
    if (result.ai.questions.length) {
      console.log(`\n${c.bold}QUESTIONS FOR YOU${c.reset}`);
      result.ai.questions.forEach((q) => console.log(`  ? ${q}`));
    }
  } else if (result.notice) console.log(`\n${c.warning}${result.notice}${c.reset}`);
  const r = result.refined;
  console.log(`\n${c.bold}REFINED MESSAGE${c.reset}\nTitle: ${r.title} (${r.title.length}/50)\nShort description: ${r.short_description} (${r.short_description.length}/50)\n\n${r.body}\n`);
  const rem = result.remaining.filter((i) => i.severity !== 'info');
  console.log(`${c.bold}STILL TO CHECK${c.reset} ${rem.length ? '' : '– nothing outstanding'}`);
  rem.forEach((i) => console.log(`  ${c[i.severity]}•${c.reset} ${i.message}${i.excerpt ? ` – "${i.excerpt}"` : ''}`));
  console.log(`\n${c.bold}BEFORE YOU SUBMIT${c.reset}`);
  result.manualChecks.forEach((m) => console.log(`  [ ] ${m.text}`));
}

if (values.out) {
  fs.writeFileSync(values.out, await buildDocx(result.refined));
  console.error(`\nSaved refined message to ${values.out}`);
}
