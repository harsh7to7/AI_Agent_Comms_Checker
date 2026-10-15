const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH_RE = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)';
const WEEKDAY_RE = '(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tues|Tue|Wed|Thurs|Thur|Thu|Fri|Sat|Sun)';

const monthIndex = (m) => MONTHS.findIndex((full) => full.toLowerCase().startsWith(m.toLowerCase().slice(0, 3)));
const weekdayIndex = (w) => WEEKDAYS.findIndex((full) => full.toLowerCase().startsWith(w.toLowerCase().slice(0, 3)));

export const ordinal = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
};

export const formatDate = (date) =>
  `${WEEKDAYS[date.getUTCDay()]}, ${ordinal(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]}`;

const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const DAY = 86400000;

export function parseISODate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? utc(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function todayUTC() {
  const n = new Date();
  return utc(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Picks the most plausible year for a yearless date, relative to the reference (send) date. */
function resolveYear(month, day, weekday, ref) {
  const candidates = [-1, 0, 1]
    .map((o) => utc(ref.getUTCFullYear() + o, month, day))
    .filter((d) => d.getUTCDate() === day && d - ref > -200 * DAY && d - ref < 300 * DAY);
  if (!candidates.length) return null;
  if (weekday >= 0) {
    const match = candidates.find((d) => d.getUTCDay() === weekday);
    if (match) return match;
  }
  return candidates.sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref))[0];
}

/**
 * Finds written dates and returns any house-style problems (G26, G27, G30).
 * @param {string} text
 * @param {Date} ref reference date (send date, or today)
 */
export function checkDates(text, ref) {
  const found = [];
  const issues = [];

  const dayFirst = new RegExp(
    `\\b(?:${WEEKDAY_RE}\\b(\\s*[,.]?\\s*))?(\\d{1,2})(st|nd|rd|th)?\\s+(of\\s+)?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`,
    'gi',
  );
  for (const m of text.matchAll(dayFirst)) {
    const [raw, wd, sep, dayStr, suffix, of, mon, yearStr] = m;
    found.push(analyse({ raw, index: m.index, wd, sep, day: Number(dayStr), suffix, of, mon, yearStr, monthFirst: false }));
  }

  const monthFirst = new RegExp(`\\b(?:${WEEKDAY_RE}\\s*,?\\s*)?${MONTH_RE}\\s+(\\d{1,2})(st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'gi');
  for (const m of text.matchAll(monthFirst)) {
    const [raw, wd, mon, dayStr, suffix, yearStr] = m;
    if (mon === 'may' || /^(Mar|Sat|Sun|Wed)$/.test(mon)) continue; // "may 3" is almost never a date
    if (found.some((f) => m.index >= f.index && m.index < f.index + f.raw.length)) continue;
    found.push(analyse({ raw, index: m.index, wd, sep: ' ', day: Number(dayStr), suffix, mon, yearStr, monthFirst: true }));
  }

  function analyse({ raw, index, wd, sep, day, suffix, of, mon, yearStr, monthFirst }) {
    const month = monthIndex(mon);
    const weekday = wd ? weekdayIndex(wd) : -1;
    const date = yearStr ? utc(Number(yearStr), month, day) : resolveYear(month, day, weekday, ref);
    const problems = [];
    if (!date || date.getUTCDate() !== day) {
      problems.push('this date does not exist');
    } else {
      if (weekday >= 0 && date.getUTCDay() !== weekday)
        problems.push(`${ordinal(day)} ${MONTHS[month]} ${date.getUTCFullYear()} is a ${WEEKDAYS[date.getUTCDay()]}, not a ${WEEKDAYS[weekday]}`);
      if (weekday < 0) problems.push('add the day of the week');
    }
    if (wd && WEEKDAYS[weekday] !== wd.replace(/^./, (c) => c.toUpperCase())) problems.push('write the day in full');
    if (wd && sep !== undefined && !/^,\s$/.test(sep)) problems.push(`use a comma after the day ("${WEEKDAYS[weekday]}, ")`);
    if (!suffix) problems.push('add the ordinal (e.g. 6th)');
    if (of) problems.push('drop "of"');
    if (MONTHS[month] !== mon) problems.push('write the month in full');
    if (monthFirst) problems.push('use British order: day before month');

    const hasYear = Boolean(yearStr);
    const suggestion = date && date.getUTCDate() === day ? formatDate(date) + (hasYear ? ` ${yearStr}` : '') : null;
    return { raw: raw.trim(), index, date, problems, suggestion, inPast: date && date < ref };
  }

  for (const f of found) {
    const real = f.problems.filter((p) => p !== 'add the day of the week');
    if (f.problems.some((p) => p.includes(', not a ') || p.includes('does not exist'))) {
      issues.push({ id: 'date-weekday', guideline: 'G2/G30', severity: 'error', message: `Date error: ${f.problems.find((p) => p.includes('not a') || p.includes('exist'))}.`, excerpt: f.raw, suggestion: f.date && f.date.getUTCDate() ? formatDate(f.date) : undefined });
      continue;
    }
    if (real.length) {
      issues.push({ id: 'date-format', guideline: 'G26/G27', severity: 'error', message: `Date format: ${real.join('; ')}.`, excerpt: f.raw, suggestion: f.suggestion, fix: f.suggestion });
    } else if (f.problems.includes('add the day of the week')) {
      issues.push({ id: 'date-weekday-missing', guideline: 'G26', severity: 'warning', message: 'Write dates in full, including the day of the week.', excerpt: f.raw, suggestion: f.suggestion });
    }
    if (f.inPast)
      issues.push({ id: 'date-past', guideline: 'G30', severity: 'warning', message: `This date (${formatDate(f.date)} ${f.date.getUTCFullYear()}) is before the send date – check it hasn't passed.`, excerpt: f.raw });
  }

  for (const m of text.matchAll(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/g)) {
    // Skip things like "Years 3/4" or "2/3 of".
    if (/(years?|grades?|sets?|y)\s*$/i.test(text.slice(Math.max(0, m.index - 7), m.index))) continue;
    issues.push({ id: 'date-numeric', guideline: 'G26', severity: 'error', message: 'Write dates in full, e.g. "Thursday, 6th November", not numeric dates.', excerpt: m[0] });
  }

  return { dates: found.filter((f) => f.date).map((f) => f.date), issues };
}

/** Time format checks (G28). Returns issues with a mechanical fix where safe. */
export function checkTimes(text) {
  const issues = [];
  for (const m of text.matchAll(/\b(\d{1,2}):([0-5]\d)\s?(am|pm|a\.m\.|p\.m\.)?(?![\d])/gi)) {
    const h = Number(m[1]);
    const ampm = m[3]?.replace(/\./g, '').toLowerCase();
    if (h > 23) continue;
    const fix = ampm ? `${h}.${m[2]}${ampm}` : h === 0 ? `12.${m[2]}am` : h < 12 ? `${h}.${m[2]}am` : `${h === 12 ? 12 : h - 12}.${m[2]}pm`;
    issues.push({
      id: ampm ? 'time-colon' : 'time-24h',
      guideline: 'G28',
      severity: 'error',
      message: ampm ? 'Use a full stop in times: 7.45am, not 7:45am.' : 'Do not use the 24-hour clock; write e.g. 2.30pm.',
      excerpt: m[0],
      suggestion: ampm ? fix : `${fix} (check am/pm)`,
      fix: ampm ? fix : undefined,
    });
  }
  for (const m of text.matchAll(/\b(1[3-9]|2[0-3])\.([0-5]\d)\b(?!\s?(am|pm))|\b([01]\d|2[0-3])([0-5]\d)\s?(hrs|hours|h)\b/gi)) {
    issues.push({ id: 'time-24h', guideline: 'G28', severity: 'error', message: 'Do not use the 24-hour clock; write e.g. 2.30pm.', excerpt: m[0] });
  }
  for (const m of text.matchAll(/\b(\d{1,2})(?:\.(\d{2}))?\s+(am|pm)\b/gi)) {
    issues.push({ id: 'time-space', guideline: 'G28', severity: 'warning', message: 'No space between the time and am/pm.', excerpt: m[0], fix: `${m[1]}${m[2] ? '.' + m[2] : '.00'}${m[3].toLowerCase()}` });
  }
  for (const m of text.matchAll(/\b(\d{1,2})(?:\.(\d{2}))?(AM|PM|Am|Pm|a\.m\.|p\.m\.)(?=\W|$)/g)) {
    issues.push({ id: 'time-case', guideline: 'G28', severity: 'warning', message: 'Write am/pm in lower case without dots, e.g. 7.45am.', excerpt: m[0], fix: `${m[1]}.${m[2] || '00'}${m[3].replace(/\./g, '').toLowerCase()}` });
  }
  for (const m of text.matchAll(/(?<![.:\d])\b(\d{1,2})(am|pm)\b/g)) {
    issues.push({ id: 'time-minutes', guideline: 'G28', severity: 'info', message: 'House style includes minutes, e.g. 8.00am.', excerpt: m[0], fix: `${m[1]}.00${m[2]}` });
  }
  return issues;
}

export { WEEKDAYS, MONTHS, DAY };
