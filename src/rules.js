import { SCHOOLS, MERGE_FIELDS, TITLE_MAX, DESCRIPTION_MAX } from './guidelines.js';
import { checkDates, checkTimes, parseISODate, todayUTC, formatDate, WEEKDAYS, DAY } from './dates.js';

// Upper-case tokens that are legitimately capitalised (acronyms, year groups, the HERE link word).
const ALLOWED_CAPS = new Set(
  'HERE DESS FS FS1 FS2 SLT PE ECA ECAs SENCO SEN SEND PA AED UAE KHDA ICT IB GCSE GCSEs IGCSE BTEC PTA PTFA EAL DT STEM IT ID MFL ADEK CAT CAT4 GL PTE PASS SATs SAT EYFS KS1 KS2 KS3 KS4 KS5 UK USA MUN DofE CEO HR PSHE RE PSHCE RSE MS COVID NHS AQA OCR EDEXCEL CIE CAIE UCAS SATS IELTS TOEFL BBQ DIY FAQ FAQs PDF URL TBC TBA OK MOE MOEHE DHA RTA DEWA CCTV AM PM'.split(' '),
);

// American → British spellings commonly seen in school comms.
const US_UK = {
  color: 'colour', colors: 'colours', colorful: 'colourful', favorite: 'favourite', favorites: 'favourites',
  center: 'centre', centers: 'centres', behavior: 'behaviour', behaviors: 'behaviours', honor: 'honour',
  neighbor: 'neighbour', neighbors: 'neighbours', labor: 'labour', humor: 'humour', theater: 'theatre',
  meter: 'metre', meters: 'metres', liter: 'litre', catalog: 'catalogue', dialog: 'dialogue',
  enroll: 'enrol', enrollment: 'enrolment', fulfill: 'fulfil', skillful: 'skilful', traveling: 'travelling',
  traveled: 'travelled', canceled: 'cancelled', canceling: 'cancelling', labeled: 'labelled', modeling: 'modelling',
  jewelry: 'jewellery', gray: 'grey', mom: 'mum', moms: 'mums', math: 'maths', vacation: 'holiday',
  fall: null, // too ambiguous
  practicing: 'practising', defense: 'defence', offense: 'offence', license: 'licence (noun)',
  program: 'programme (unless a computer program)', programs: 'programmes', aluminum: 'aluminium',
  pajamas: 'pyjamas', cozy: 'cosy', analyze: 'analyse', paralyze: 'paralyse', catalyze: 'catalyse',
  recess: 'break', semester: 'term', grade: 'year (if referring to a year group)',
};

const IZE_EXCEPTIONS = new Set(['size', 'sized', 'sizes', 'prize', 'prizes', 'seize', 'seized', 'capsize', 'resize', 'downsize']);

const issue = (o) => ({ severity: 'warning', field: 'body', ...o });

function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end < 0 ? undefined : end).trim();
}

// Email addresses and URLs must not trip the "@", spacing or full-stop rules.
const maskLinks = (t) =>
  t.replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b|\bhttps?:\/\/\S+|\bwww\.\S+/g, (m) => '\u0000'.repeat(m.length));

/**
 * Runs every deterministic guideline check.
 * @param {object} msg { title, shortDescription, body, paragraphs?, school, audience, sendDate, archiveDate, fromTeacher }
 */
export function runRules(msg) {
  const out = [];
  const title = (msg.title || '').trim();
  const desc = (msg.shortDescription || '').trim();
  const body = (msg.body || '').replace(/\r\n/g, '\n');
  const school = SCHOOLS[msg.school] ? msg.school : null;
  const ref = parseISODate(msg.sendDate) || todayUTC();

  // ---------- Title & short description (G3, G8) ----------
  if (!title) out.push(issue({ id: 'title-missing', field: 'title', severity: 'error', guideline: 'G8', message: 'A title is required.' }));
  if (title.length > TITLE_MAX)
    out.push(issue({ id: 'title-length', field: 'title', severity: 'error', guideline: '3/G8', message: `Title is ${title.length} characters (max ${TITLE_MAX}).`, excerpt: title }));
  if (!desc) out.push(issue({ id: 'desc-missing', field: 'description', severity: 'error', guideline: 'G8', message: 'A short description is required.' }));
  if (desc.length > DESCRIPTION_MAX)
    out.push(issue({ id: 'desc-length', field: 'description', severity: 'error', guideline: 'G8', message: `Short description is ${desc.length} characters (max ${DESCRIPTION_MAX}).`, excerpt: desc }));
  if (title && desc && norm(title) === norm(desc))
    out.push(issue({ id: 'title-desc-same', field: 'description', severity: 'error', guideline: 'G8', message: 'Title and short description must be different.' }));
  else if (title && desc && (norm(desc).includes(norm(title)) || norm(title).includes(norm(desc))))
    out.push(issue({ id: 'title-desc-overlap', field: 'description', severity: 'warning', guideline: 'G8', message: 'Title and short description largely repeat each other.', excerpt: desc }));
  if (title.includes('&'))
    out.push(issue({ id: 'title-ampersand', field: 'title', severity: 'error', guideline: 'G8a', message: "Don't use '&' in the title – write 'and'.", excerpt: title, fix: title.replace(/\s*&\s*/g, ' and ') }));
  if (desc && !/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|\b\d{1,2}(st|nd|rd|th)\b/i.test(desc))
    out.push(issue({ id: 'desc-date', field: 'description', severity: 'info', guideline: 'G8b', message: 'Consider making the short description the date, e.g. "Wednesday, 7th January".', excerpt: desc }));
  if (['year-group', 'class'].includes(msg.audience) && title && !/^(Y\d{1,2}|Year\s?\d{1,2}|FS[12])\b/i.test(title))
    out.push(issue({ id: 'title-year-group', field: 'title', severity: 'warning', guideline: '10.2', message: 'Year-group-specific messages should start the title with the year group, e.g. "Y10 Portugal Trip".', excerpt: title }));
  for (const [field, text] of [['title', title], ['description', desc]]) {
    for (const w of capsWords(text)) out.push(issue({ id: 'caps', field, severity: 'error', guideline: 'G19', message: 'No all-caps text.', excerpt: w }));
    checkSchoolNames(text, field, school, out);
    for (const m of text.matchAll(/\s@\s?|\s@(?=\w)/g)) out.push(issue({ id: 'at-symbol', field, severity: 'error', guideline: 'G14', message: "Write 'at' instead of '@'.", excerpt: lineAt(text, m.index) }));
    for (const d of checkDates(text, ref).issues.filter((i) => i.id !== 'date-past')) out.push({ ...d, field });
  }

  // ---------- Opening, tone, sign-off (G9, G10, G29) ----------
  const firstLine = body.split('\n').find((l) => l.trim()) || '';
  if (/^\s*(dear|hello|hi|good (morning|afternoon))\b/i.test(firstLine))
    out.push(issue({ id: 'opening-dear', severity: 'error', guideline: 'G10', message: 'Messages should not start with "Dear Parent(s)" or a greeting – start with the content.', excerpt: firstLine.trim() }));
  const fluff = [
    /i hope (this|that) (email|message|letter) finds you well/i, /hope you are (keeping )?well/i, /if you are receiving this (letter|email|message)/i,
    /we are (writing|reaching out) to (inform|let) you/i, /i am writing to (inform|let) you/i, /please do not hesitate to contact/i,
    /this (letter|email) is to inform you/i,
  ];
  for (const re of fluff) {
    const m = body.match(re);
    if (m) out.push(issue({ id: 'tone-fluff', severity: 'warning', guideline: 'G9', message: 'Keep it concise and parent-friendly – cut stock phrases.', excerpt: m[0] }));
  }
  const signOff = body.match(/yours (sincerely|faithfully|truly)|best wishes|warm(est)? regards|many thanks,?\s*$|thanks and regards/i);
  if (signOff) out.push(issue({ id: 'signoff-wrong', severity: 'error', guideline: 'G29', message: 'Only "Kind regards," is used as a sign-off (and only from an individual teacher).', excerpt: signOff[0] }));
  if (/kind regards/i.test(body) && !msg.fromTeacher)
    out.push(issue({ id: 'signoff-not-teacher', severity: 'warning', guideline: 'G29', message: 'No sign-off unless the message is from an individual teacher.', excerpt: 'Kind regards' }));
  for (const m of body.matchAll(/\b(Mr|Mrs|Ms|Miss|Dr|Mx)\.(?=\s)/g))
    out.push(issue({ id: 'title-dot', severity: 'error', guideline: 'G29', message: 'No full stop after Mr/Mrs/Ms/Dr.', excerpt: excerptAround(body, m.index, 20), find: m[0], fix: m[1] }));

  // ---------- Symbols, links, spacing (G12–G17, G20, G24) ----------
  const masked = maskLinks(body);
  for (const m of masked.matchAll(/(^|[^\w\u0000])@(?=\s?\w)/g))
    out.push(issue({ id: 'at-symbol', severity: 'error', guideline: 'G14', message: "Write 'at' instead of '@' (e.g. at DESS Academic City).", excerpt: excerptAround(body, m.index), find: '@', fix: 'at' }));
  for (const m of masked.matchAll(/[^\n\S]{2,}(?=\S)/g)) {
    const line = lineAt(body, m.index);
    if (!line) continue;
    out.push(issue({ id: 'double-space', severity: 'error', guideline: 'G15/G20', message: /[.!?]$/.test(body.slice(0, m.index)) ? 'Only one space after a full stop.' : 'Remove extra spaces.', excerpt: excerptAround(body, m.index), autofix: true }));
  }
  for (const m of masked.matchAll(/ +([,.;:!?])(?!\d)/g))
    out.push(issue({ id: 'space-before-punct', severity: 'error', guideline: 'G20', message: `No space before "${m[1]}" (e.g. "Time: 8.00am").`, excerpt: excerptAround(body, m.index), autofix: true }));
  for (const m of masked.matchAll(/[a-z]{2,}[.!?](?=[A-Z][a-z])/g))
    out.push(issue({ id: 'missing-space', severity: 'warning', guideline: 'G2', message: 'Missing space after full stop.', excerpt: excerptAround(body, m.index) }));
  for (const m of body.matchAll(/,\s*$/gm))
    if (!/kind regards,\s*$|^\s*(dear|hello|hi)\b/i.test(lineAt(body, m.index)))
      out.push(issue({ id: 'trailing-comma', severity: 'warning', guideline: 'G2', message: 'Paragraph ends with a comma – should this be a full stop?', excerpt: lineAt(body, m.index) }));
  for (const m of body.matchAll(/\b(\w+)\s+\1\b/gi))
    if (!/^(\d+|that|had|is)$/i.test(m[1])) out.push(issue({ id: 'repeated-word', severity: 'warning', guideline: 'G2', message: 'Repeated word.', excerpt: m[0] }));
  if (/!{2,}|\?{2,}/.test(body)) out.push(issue({ id: 'punct-repeat', severity: 'warning', guideline: 'G9', message: 'Avoid repeated punctuation (!!).' }));
  if (/\n\s*\n\s*\n/.test(body)) out.push(issue({ id: 'blank-lines', severity: 'info', guideline: 'G20', message: 'Remove unnecessary blank lines between details.' }));

  const emoji = body.match(/\p{Extended_Pictographic}/gu);
  if (emoji) out.push(issue({ id: 'emoji', severity: 'error', guideline: 'G17', message: 'No emojis.', excerpt: [...new Set(emoji)].join(' ') }));
  const symbols = body.match(/[✓✔✗✘★☆→⇒➔➢➤►▶♦◆●■□▪❖※♥☺]/g);
  if (symbols) out.push(issue({ id: 'symbols', severity: 'error', guideline: 'G17', message: 'Use plain bullet points only – no symbols.', excerpt: [...new Set(symbols)].join(' ') }));
  if (/\bQR\b|qr code/i.test(body)) out.push(issue({ id: 'qr-code', severity: 'error', guideline: 'G16', message: "Don't use QR codes – include the link instead." }));

  for (const m of body.matchAll(/\b(click|tap|press|link|form|guide|sign[- ]?up|register|book|access|view|download|find (out )?more|available|details)\b[^.\n]{0,40}?\b(here)\b/gi))
    if (m[3] !== 'HERE')
      out.push(issue({ id: 'link-here', severity: 'error', guideline: 'G24', message: 'The link word should be HERE (in capitals) with the hyperlink on it.', excerpt: m[0], find: m[0], fix: m[0].replace(/here$/i, 'HERE') }));
  for (const m of body.matchAll(/\bhttps?:\/\/\S+|\bwww\.\S+/g))
    out.push(issue({ id: 'raw-url', severity: 'warning', guideline: 'G24', message: 'Put the link behind the word HERE instead of pasting the URL.', excerpt: m[0].slice(0, 60) }));
  if (/\bsign-up the link\b|\bsign up the link\b/i.test(body))
    out.push(issue({ id: 'grammar-signup', severity: 'warning', guideline: 'G2', message: 'Grammar: "sign up via the link HERE".', excerpt: body.match(/sign-?\s?up the link/i)[0] }));
  if (/\.(pptx?|docx?|xlsx?)\b|\bpower ?point\b/i.test(body))
    out.push(issue({ id: 'attachment-format', severity: 'error', guideline: 'G25', message: 'Attachments must be branded PDFs (no PowerPoint/Word/Excel files).', excerpt: body.match(/\S*\.(pptx?|docx?|xlsx?)\b|\bpower ?point\b/i)[0] }));

  // ---------- Capitals (G19) ----------
  for (const w of capsWords(body)) out.push(issue({ id: 'caps', severity: 'error', guideline: 'G19', message: 'No all-caps words – use bold to emphasise.', excerpt: w }));

  // ---------- Money (G18) ----------
  for (const m of body.matchAll(/\bAED\s+\d[\d,]*(\.\d+)?|\b\d[\d,]*(\.\d+)?\s*(AED|dhs|dirhams?)\b|\bDhs?\.?\s*\d[\d,]*|\bAED\d[\d,]*(\.\d+)?\s*(only|\/-|dirhams?)/gi)) {
    const amount = m[0].match(/\d[\d,]*(\.\d+)?/)[0].replace(/,/g, '');
    out.push(issue({ id: 'money', severity: 'error', guideline: 'G18', message: 'Write money as AED3000 – no space, nothing after the number.', excerpt: m[0], find: m[0], fix: `AED${amount}` }));
  }
  for (const m of body.matchAll(/\bAED\d{1,3}(,\d{3})+\b/g))
    out.push(issue({ id: 'money-comma', severity: 'info', guideline: 'G18', message: 'House example is AED3000 (no comma separator).', excerpt: m[0] }));

  // ---------- British English (G22) ----------
  for (const m of body.matchAll(/\b[A-Za-z]+\b/g)) {
    const w = m[0].toLowerCase();
    if (w in US_UK && US_UK[w])
      out.push(issue({ id: 'us-spelling', severity: w === 'program' || w === 'grade' ? 'info' : 'warning', guideline: 'G22', message: `British English: "${US_UK[w]}".`, excerpt: m[0] }));
    else if (/i[zZ](e|es|ed|ing|ation|ations|er|ers)$/.test(w) && !IZE_EXCEPTIONS.has(w) && w.length > 5)
      out.push(issue({ id: 'us-spelling', severity: 'warning', guideline: 'G22', message: `British English uses -ise: "${m[0].replace(/iz/i, (s) => (s[1] === 'Z' ? 'iS' : 'is'))}".`, excerpt: m[0], find: m[0], fix: m[0].replace(/iz/, 'is') }));
  }

  // ---------- Audience wording (G23, merge fields) ----------
  if (school) {
    const phase = SCHOOLS[school].phase;
    if (phase === 'primary')
      for (const m of body.matchAll(/\b(students?|pupils?)\b/gi))
        out.push(issue({ id: 'children-students', severity: 'error', guideline: 'G23', message: 'At the primaries, refer to "children" (not students/pupils).', excerpt: excerptAround(body, m.index) }));
    if (phase === 'secondary')
      for (const m of body.matchAll(/\b(pupils?|children)\b/gi))
        out.push(issue({ id: 'children-students', severity: /pupil/i.test(m[0]) ? 'error' : 'warning', guideline: 'G23', message: 'At the College, refer to "students".', excerpt: excerptAround(body, m.index) }));
  }
  checkSchoolNames(body, 'body', school, out);
  if (/\bDESS\s+(sports?\s+|PE\s+)?kit\b/i.test(body))
    out.push(issue({ id: 'kit', severity: 'error', guideline: 'G33', message: "Say 'school kit' or 'school sports kit', not 'DESS sports kit'.", excerpt: body.match(/\bDESS\s+(sports?\s+|PE\s+)?kit\b/i)[0] }));
  for (const m of body.matchAll(/\bParents Evenings?\b/g))
    out.push(issue({ id: 'parents-evening', severity: 'warning', guideline: 'G2', message: "House style: \"Parents' Evening\".", excerpt: m[0], find: m[0], fix: m[0].replace('Parents', "Parents'") }));
  for (const m of body.matchAll(/\b([A-Z]{2,}\d?)['’]s\b(?=\s+(run|are|were|will|have|and|or|\(|,|\.|$))/gm))
    out.push(issue({ id: 'plural-apostrophe', severity: 'error', guideline: 'G2', message: `Plural acronyms take no apostrophe: "${m[1]}s".`, excerpt: m[0], find: m[0], fix: `${m[1]}s` }));
  for (const m of body.matchAll(/\b(ECA|PTA|SLT|SEN|ID|CAT4?)['’]s\s*$/gm))
    out.push(issue({ id: 'plural-apostrophe', severity: 'error', guideline: 'G2', message: `Plural acronyms take no apostrophe: "${m[1]}s".`, excerpt: m[0], find: m[0], fix: `${m[1]}s` }));

  const fields = body.match(/\{\{[^}]*\}\}/g) || [];
  for (const f of fields)
    if (!MERGE_FIELDS.includes(f)) out.push(issue({ id: 'merge-invalid', severity: 'error', guideline: 'Merge fields', message: `Unknown merge field ${f}.`, excerpt: f, suggestion: 'Use one of the listed merge fields or ask the comms team for a new one.' }));
  for (const m of body.matchAll(/\}\}(?=[A-Za-z])|\}\}\s{2,}(?=\S)|(?<=[A-Za-z])\{\{/g))
    out.push(issue({ id: 'merge-spacing', severity: 'error', guideline: 'Merge fields', message: 'Exactly one space between a merge field and the neighbouring word.', excerpt: excerptAround(body, m.index) }));
  if (msg.audience && msg.audience !== 'whole-school') {
    const yourChild = [...body.matchAll(/\byour (child|son|daughter|son\/daughter|children)('s)?\b/gi)];
    for (const m of yourChild)
      out.push(issue({ id: 'merge-your-child', severity: 'warning', guideline: 'Merge fields', message: 'Personalise: replace "your child" with a merge field.', excerpt: m[0], suggestion: m[2] ? '{{student.forename_apostrophe_s}}' : '{{student.forename}}' }));
    if (!fields.length)
      out.push(issue({ id: 'merge-missing', severity: 'warning', guideline: 'Merge fields', message: 'Merge fields should be included unless the audience is the whole school.' }));
  }
  if (/\bparents (are|should|will|can|must|may|need)\b/i.test(body) && msg.audience !== 'whole-school')
    out.push(issue({ id: 'address-you', severity: 'info', guideline: 'Merge fields', message: 'Address the parent directly ("you") rather than "parents".', excerpt: body.match(/\bparents (are|should|will|can|must|may|need)\b/i)[0] }));

  // ---------- Dates & times (G26–G28, G30) ----------
  const { dates, issues: dateIssues } = checkDates(body, ref);
  out.push(...dateIssues.map((d) => ({ field: 'body', ...d })));
  out.push(...checkTimes(maskLinks(body)).map((t) => ({ field: 'body', ...t })));
  if (dates.length)
    out.push(issue({ id: 'calendar', severity: 'info', guideline: '5', message: 'This message contains dates – make sure each event date is in the parent calendar.' }));

  // ---------- Scheduling (1, Q7, Q8) ----------
  checkSchedule(msg, dates, out);

  // ---------- Formatting from .docx (4, G11, G12, G16, G19, G21) ----------
  if (msg.paragraphs?.length) checkFormatting(msg.paragraphs, out);

  return dedupe(out);
}

function checkSchoolNames(text, field, school, out) {
  const banned = [
    [/\bDOM\b/g, 'DESS Oud Metha'], [/\bDAC\b/g, 'DESS Academic City'], [/\bDESC\b/g, 'DESS College'],
    [/\bDESS Primary\b/gi, 'DESS Oud Metha / DESS Academic City'], [/\bDESS\s*(AC|OM)\b/g, 'DESS Academic City / DESS Oud Metha'],
    [/\bDESS Schools\b/gi, 'DESS'], [/\bDESS\/(AC|OM)\b/g, 'the full school name'],
  ];
  for (const [re, fix] of banned)
    for (const m of text.matchAll(re))
      out.push(issue({ id: 'school-name', field, severity: 'error', guideline: 'Naming', message: `Use the official school name (${fix}).`, excerpt: m[0], find: m[0], fix: fix.includes('/') ? undefined : fix }));
  if (school && school !== 'all') {
    for (const m of text.matchAll(/\bDESS\b(?!\s+(Oud Metha|Academic City|College|Caf[eé]|App|family|community of schools|Group))/g)) {
      const after = text.slice(m.index + 4, m.index + 20);
      if (/^\s*(sports )?kit/i.test(after)) continue;
      out.push(issue({ id: 'school-name-bare', field, severity: 'warning', guideline: 'Naming', message: `"DESS" alone means the family of schools – name the school (${SCHOOLS[school].name}).`, excerpt: excerptAround(text, m.index) }));
    }
  }
  if (/\bDESSCaf/i.test(text)) out.push(issue({ id: 'school-name', field, severity: 'warning', guideline: 'G2', message: 'Missing space: "DESS Café".', excerpt: 'DESSCafé', find: 'DESSCafé', fix: 'DESS Café' }));
}

function checkSchedule(msg, dates, out) {
  const send = parseISODate(msg.sendDate);
  const archive = parseISODate(msg.archiveDate);
  const today = todayUTC();
  if (send) {
    if (send.getUTCDay() === 5)
      out.push(issue({ id: 'send-friday', field: 'schedule', severity: 'error', guideline: '1/Q7', message: 'Avoid communication going out on a Friday.', excerpt: formatDate(send) }));
    const hours = (send - today) / 3600000;
    if (hours < 0) out.push(issue({ id: 'send-past', field: 'schedule', severity: 'error', guideline: 'Q7', message: 'Send date is in the past.', excerpt: formatDate(send) }));
    else if (hours < 48) out.push(issue({ id: 'send-notice', field: 'schedule', severity: 'warning', guideline: '1/Q7', message: 'Less than 48 hours’ notice for the comms team.', excerpt: formatDate(send) }));
    if (send.getUTCDay() === 6) out.push(issue({ id: 'send-weekend', field: 'schedule', severity: 'warning', guideline: 'Q7', message: 'Send date falls on a Saturday – is that intended?', excerpt: formatDate(send) }));
  }
  const future = dates.filter((d) => !send || d >= send).sort((a, b) => a - b);
  if (archive) {
    if (send && archive <= send)
      out.push(issue({ id: 'archive-before-send', field: 'schedule', severity: 'error', guideline: 'Q8', message: 'Archive date must be after the send date.' }));
    if (future.length) {
      const last = future.at(-1);
      const ideal = new Date(last.getTime() + DAY);
      if (archive < ideal)
        out.push(issue({ id: 'archive-early', field: 'schedule', severity: 'error', guideline: 'Q8', message: `Archive date is before the last date in the message (${formatDate(last)}). Archive the day after: ${formatDate(ideal)}.`, suggestion: iso(ideal) }));
      else if (archive - ideal > 3 * DAY)
        out.push(issue({ id: 'archive-late', field: 'schedule', severity: 'warning', guideline: 'Q8', message: `Don't keep messages live longer than needed. Suggested archive date: ${formatDate(ideal)} (the day after ${formatDate(last)}).`, suggestion: iso(ideal) }));
    }
  } else if (future.length) {
    const ideal = new Date(future.at(-1).getTime() + DAY);
    out.push(issue({ id: 'archive-suggest', field: 'schedule', severity: 'info', guideline: 'Q8', message: `Suggested archive date: ${formatDate(ideal)} (the day after the last date mentioned).`, suggestion: iso(ideal) }));
  }
}

function checkFormatting(paragraphs, out) {
  const runs = paragraphs.flatMap((p) => p.runs.filter((r) => r.text.trim()));
  const fonts = new Map();
  const sizes = new Map();
  for (const r of runs) {
    fonts.set(r.font, (fonts.get(r.font) || []).concat(r.text));
    sizes.set(r.size, (sizes.get(r.size) || 0) + r.text.length);
  }
  for (const [font, texts] of fonts)
    if (!/^montserrat/i.test(font))
      out.push(issue({ id: 'font', field: 'format', severity: 'error', guideline: '4', message: `Text is in "${font}" – all text must be Montserrat.`, excerpt: texts.join(' ').trim().slice(0, 80) }));
  if (sizes.size > 1) {
    const main = [...sizes].sort((a, b) => b[1] - a[1])[0][0];
    for (const r of runs.filter((x) => x.size !== main).slice(0, 5))
      out.push(issue({ id: 'font-size', field: 'format', severity: 'error', guideline: '4', message: `Mixed font sizes: ${r.size}pt vs ${main}pt. All text (including merge fields) must be the same size.`, excerpt: r.text.trim().slice(0, 60) }));
  }
  const coloured = runs.filter((r) => !r.link && r.color !== '000000');
  if (coloured.length)
    out.push(issue({ id: 'colour', field: 'format', severity: 'error', guideline: 'G11/G19', message: `Text must be black only – found colour ${[...new Set(coloured.map((r) => '#' + r.color))].join(', ')}. Use bold to highlight.`, excerpt: [...new Set(coloured.map((r) => r.text.trim()))].slice(0, 6).join(' / ') }));
  const highlighted = runs.filter((r) => r.highlight);
  if (highlighted.length)
    out.push(issue({ id: 'highlight', field: 'format', severity: 'error', guideline: 'G11', message: 'Remove highlighting – use bold for key points.', excerpt: highlighted.map((r) => r.text.trim()).slice(0, 4).join(' / ') }));
  const caps = runs.filter((r) => r.caps);
  if (caps.length)
    out.push(issue({ id: 'caps-format', field: 'format', severity: 'error', guideline: 'G19', message: 'All-caps formatting is applied to some text.', excerpt: caps.map((r) => r.text.trim()).slice(0, 4).join(' / ') }));
  if (paragraphs.some((p) => p.images))
    out.push(issue({ id: 'images', field: 'format', severity: 'warning', guideline: 'G12/G16', message: 'The body contains images – links must be in the text, and no QR codes.' }));

  for (const p of paragraphs)
    for (const r of p.runs.filter((x) => x.link)) {
      if (r.text.trim() && r.text.replace(/[^\w@]/g, '') !== 'HERE' && !/@/.test(r.text))
        out.push(issue({ id: 'link-word', field: 'format', severity: 'error', guideline: 'G24', message: 'The hyperlink should sit on the word HERE.', excerpt: r.text.trim() }));
      if (/\.(pptx?|docx?|xlsx?)(\?|$)/i.test(r.link))
        out.push(issue({ id: 'link-attachment', field: 'format', severity: 'error', guideline: 'G25', message: 'This link points to an Office file – attachments must be branded PDFs.', excerpt: decodeURIComponent(r.link.split('/').pop()) }));
    }

  // Key details in bold (G21): flag dates/times that sit in non-bold runs.
  const plainKeyDetails = [];
  for (const p of paragraphs) {
    let pos = 0;
    const spans = p.runs.map((r) => ({ ...r, start: pos, end: (pos += r.text.length) }));
    for (const m of p.text.matchAll(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b[^\n]{0,25}?\b\d{1,2}(st|nd|rd|th)\s+[A-Z][a-z]+|\b\d{1,2}\.\d{2}(am|pm)\b/g)) {
      const covering = spans.filter((s) => s.end > m.index && s.start < m.index + m[0].length && s.text.trim());
      if (covering.length && !covering.every((s) => s.bold)) plainKeyDetails.push(m[0]);
    }
  }
  if (plainKeyDetails.length)
    out.push(issue({ id: 'bold-key-details', field: 'format', severity: 'info', guideline: 'G21', message: 'Emphasise key details (dates, times, locations) in bold.', excerpt: [...new Set(plainKeyDetails)].slice(0, 5).join(' / ') }));
}

function capsWords(text) {
  const words = (text.match(/\b[A-Z]{3,}\b/g) || []);
  return [...new Set(words.filter((w) => !ALLOWED_CAPS.has(w) && !/^[A-Z]{2,4}\d*$/.test(w)))].concat(
    // A run of 3+ capitalised words is shouting even if each is short.
    (text.match(/\b(?:[A-Z]{2,}\s+){2,}[A-Z]{2,}\b/g) || []).filter((s) => !s.split(/\s+/).every((w) => ALLOWED_CAPS.has(w))),
  );
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const iso = (d) => d.toISOString().slice(0, 10);

function excerptAround(text, index, radius = 30) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\n/g, ' ⏎ ') + (end < text.length ? '…' : '');
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((i) => {
    const k = `${i.id}|${i.field}|${i.excerpt || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function summarise(issues) {
  const count = (s) => issues.filter((i) => i.severity === s).length;
  const errors = count('error');
  const warnings = count('warning');
  return {
    errors,
    warnings,
    info: count('info'),
    status: errors ? 'needs-changes' : warnings ? 'review' : 'ready',
  };
}

export { WEEKDAYS };
