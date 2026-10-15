import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocx } from './docx-reader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXAMPLES_DIR = process.env.COMMS_EXAMPLES_DIR || path.join(ROOT, 'examples');

let cache;

/**
 * Loads before/after pairs: any "<name> - version 1.docx" with a matching "<name> - version 2.docx".
 * Drop new pairs into the examples folder to teach the agent more of the comms team's style.
 */
export async function loadExamples() {
  if (cache) return cache;
  if (!fs.existsSync(EXAMPLES_DIR)) return (cache = []);
  const files = fs.readdirSync(EXAMPLES_DIR);
  const pairs = [];
  for (const f of files) {
    const m = f.match(/^(.*?)\s*-\s*version\s*1\.docx$/i);
    if (!m) continue;
    const after = files.find((g) => new RegExp(`^${escape(m[1])}\\s*-\\s*version\\s*2\\.docx$`, 'i').test(g));
    if (!after) continue;
    try {
      const [b, a] = await Promise.all([f, after].map((x) => readDocx(fs.readFileSync(path.join(EXAMPLES_DIR, x)))));
      pairs.push({ name: m[1], before: b, after: a });
    } catch (err) {
      console.warn(`Skipping example ${m[1]}: ${err.message}`);
    }
  }
  return (cache = pairs);
}

export function formatExamples(pairs) {
  const show = (d) => `Title: ${d.title}\nShort description: ${d.shortDescription}\nBody:\n${d.bodyMarked}`;
  return pairs
    .map(
      (p, i) =>
        `<example index="${i + 1}" name="${p.name}">\n<submitted_draft>\n${show(p.before)}\n</submitted_draft>\n<comms_team_edit>\n${show(p.after)}\n</comms_team_edit>\n</example>`,
    )
    .join('\n\n');
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
