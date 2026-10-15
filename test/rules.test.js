import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocx } from '../src/docx-reader.js';
import { runRules } from '../src/rules.js';
import { autoFix } from '../src/autofix.js';
import { checkDates, checkTimes, parseISODate } from '../src/dates.js';
import { buildDocx } from '../src/docx-writer.js';
import { stripMarkup } from '../src/markup.js';

const EX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const load = (name) => readDocx(fs.readFileSync(path.join(EX, `${name}.docx`)));
const ids = (issues) => new Set(issues.map((i) => i.id));
const base = { school: 'oud-metha', audience: 'whole-school', sendDate: '2026-10-19' };

test('Comms 1 v1: catches the problems the comms team fixed', async () => {
  const d = await load('Comms 1 - version 1');
  const found = ids(runRules({ ...d, ...base, sendDate: '2026-10-12' }));
  for (const id of ['double-space', 'space-before-punct', 'link-here', 'school-name-bare', 'parents-evening', 'plural-apostrophe', 'link-attachment', 'trailing-comma'])
    assert.ok(found.has(id), `expected ${id}`);
});

test('Comms 2 v1: catches title dots, @, dates, times, links, red text', async () => {
  const d = await load('Comms 2 - version 1');
  const found = ids(runRules({ ...d, ...base, sendDate: '2026-09-14' }));
  for (const id of ['title-dot', 'at-symbol', 'date-format', 'time-colon', 'link-here', 'colour', 'school-name'])
    assert.ok(found.has(id), `expected ${id}`);
});

test('Comms 2 v2: still flags "Monday. 28th September" and red text the team missed', async () => {
  const d = await load('Comms 2 - version 2');
  const issues = runRules({ ...d, ...base, sendDate: '2026-09-14' });
  assert.ok(issues.some((i) => i.id === 'date-format' && i.excerpt === 'Monday. 28th September'));
  assert.ok(issues.some((i) => i.id === 'colour'));
  assert.ok(!issues.some((i) => i.id === 'title-dot'));
});

test('reads template fields and Montserrat formatting', async () => {
  const d = await load('Comms 1 - version 2');
  assert.equal(d.title, 'Term 1 Parents Evening');
  assert.equal(d.shortDescription, 'Week beginning Monday, 26th October');
  assert.ok(d.paragraphs.every((p) => p.runs.every((r) => r.font === 'Montserrat')));
  assert.ok(!runRules({ ...d, ...base }).some((i) => i.id === 'font'));
});

test('dates: format, weekday mismatch, numeric, past', () => {
  const ref = parseISODate('2026-10-14');
  const r = (t) => checkDates(t, ref).issues.map((i) => i.id);
  assert.deepEqual(r('Thursday, 15th October'), []);
  assert.ok(r('Thursday 15 October').includes('date-format'));
  assert.ok(r('Friday, 15th October').includes('date-weekday'));
  assert.ok(r('on 6/11/26').includes('date-numeric'));
  assert.ok(r('Monday, 5th October').includes('date-past'));
  assert.ok(r('October 15th').includes('date-format'));
  assert.equal(checkDates('Thursday 15 October', ref).issues[0].fix, 'Thursday, 15th October');
});

test('times: 24-hour clock and colons', () => {
  assert.equal(checkTimes('at 7:45am')[0].fix, '7.45am');
  assert.equal(checkTimes('at 14:30')[0].id, 'time-24h');
  assert.equal(checkTimes('at 7.45am').length, 0);
  assert.equal(checkTimes('at 8 AM')[0].fix, '8.00am');
});

test('title, description, schedule and audience rules', () => {
  const issues = runRules({
    title: 'Science & Maths Week at DESS Oud Metha for all our children',
    shortDescription: 'Science & Maths Week at DESS Oud Metha for all our children',
    body: 'Dear Parents,\nYour child will need their DESS sports kit. Students pay AED 300. See the form here.',
    school: 'oud-metha',
    audience: 'year-group',
    sendDate: '2026-10-23', // a Friday
  });
  const found = ids(issues);
  for (const id of ['title-length', 'title-ampersand', 'title-desc-same', 'title-year-group', 'opening-dear', 'kit', 'children-students', 'money', 'link-here', 'merge-your-child', 'merge-missing', 'send-friday'])
    assert.ok(found.has(id), `expected ${id}`);
});

test('emails and URLs are not flagged as "@" misuse', () => {
  const issues = runRules({ ...base, title: 'Y4 Trip', shortDescription: 'Monday, 19th October', body: 'Contact headofdata_om@dess.sch.ae for help.' });
  assert.ok(!issues.some((i) => i.id === 'at-symbol'));
});

test('autoFix applies safe mechanical fixes', () => {
  const { text } = autoFix('Meet @ DESS Oud Metha.  Mrs. Smith : 7:45am on Thursday 15 October. Click here. Cost AED 300. ECA’s run by providers.', { sendDate: '2026-10-12' });
  assert.equal(text, 'Meet at DESS Oud Metha. Mrs Smith: 7.45am on Thursday, 15th October. Click HERE. Cost AED300. ECAs run by providers.');
});

test('archive date guidance', () => {
  const msg = { ...base, title: 'Y4 Trip', shortDescription: 'Wednesday, 4th November', body: 'The trip is on **Wednesday, 4th November**.' };
  assert.ok(runRules({ ...msg, archiveDate: '2026-11-30' }).some((i) => i.id === 'archive-late'));
  assert.ok(runRules({ ...msg, archiveDate: '2026-11-02' }).some((i) => i.id === 'archive-early'));
  assert.ok(!runRules({ ...msg, archiveDate: '2026-11-05' }).some((i) => i.id.startsWith('archive')));
});

test('docx export round-trips through the reader', async () => {
  const buf = await buildDocx({ title: 'Y4 Trip', short_description: 'Wednesday, 4th November', body: 'Book **Wednesday, 4th November** [HERE](https://example.com).\n\n- Bring a hat\n- Bring water' });
  const d = await readDocx(buf);
  assert.equal(d.title, 'Y4 Trip');
  assert.equal(d.shortDescription, 'Wednesday, 4th November');
  assert.equal(stripMarkup(d.bodyMarked), 'Book Wednesday, 4th November HERE.\n- Bring a hat\n- Bring water');
  assert.ok(!runRules({ ...d, ...base }).some((i) => ['font', 'font-size', 'colour', 'link-word'].includes(i.id)));
});
