import { checkDates, checkTimes, parseISODate, todayUTC } from './dates.js';

/**
 * Applies mechanical, meaning-preserving fixes. Used as a fallback when no AI is available
 * and as a safety net on AI output. Returns { text, changes[] }.
 */
export function autoFix(text, { sendDate } = {}) {
  const changes = [];
  const ref = parseISODate(sendDate) || todayUTC();
  let t = text.replace(/\r\n/g, '\n');

  const apply = (label, re, replacer) => {
    const before = t;
    t = t.replace(re, replacer);
    if (t !== before) changes.push(label);
  };

  // Protect emails/URLs from the "@" and spacing rules.
  const protectedTokens = [];
  t = t.replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b|\bhttps?:\/\/[^\s)]+|\(\#[^)]*\)/g, (m) => {
    protectedTokens.push(m);
    return `\u0001${protectedTokens.length - 1}\u0001`;
  });

  apply('Replaced "@" with "at"', /(^|\s)@\s?(?=\w)/gm, '$1at ');
  apply('Removed extra spaces', /([^\n\s])[^\S\n]{2,}(?=\S)/g, '$1 ');
  apply('Removed trailing spaces', /[^\S\n]+$/gm, '');
  apply('Removed space before punctuation', /(\S) +([,;:!?])/g, '$1$2');
  apply('Removed space before full stop', /([a-z]) +\.(?=\s|$)/g, '$1.');
  apply('Removed dot after Mr/Mrs/Ms/Dr', /\b(Mr|Mrs|Ms|Miss|Dr|Mx)\.(?=\s)/g, '$1');
  apply('Capitalised link word HERE', /\b(click|tap|link|form|guide|sign[- ]?up|register|book|access|view|download|available)\b([^.\n]{0,40}?)\bhere\b/gi, (_, a, b) => `${a}${b}HERE`);
  apply('Fixed "sign-up the link"', /\bsign-?\s?up the link\b/gi, 'sign up via the link');
  apply('Formatted money as AED3000', /\bAED\s+(\d[\d,]*(?:\.\d+)?)|\b(\d[\d,]*(?:\.\d+)?)\s*(?:AED|dhs|dirhams?)\b/gi, (_, a, b) => `AED${(a || b).replace(/,/g, '')}`);
  apply('Removed apostrophe from plural acronyms', /\b(ECA|PTA|SLT|CAT4?|ID)'s\b(?=\s+(run|are|were|will|have|and|or)\b|\s*\(|\s*$)/gm, '$1s');
  apply('Removed apostrophe from plural acronyms', /\b(ECA|PTA|SLT|CAT4?|ID)’s\b(?=\s+(run|are|were|will|have|and|or)\b|\s*\(|\s*$)/gm, '$1s');
  apply('"Parents Evening" → "Parents\' Evening"', /\bParents Evening/g, 'Parents’ Evening');
  apply('Fixed "DESSCafé"', /\bDESSCaf/g, 'DESS Caf');
  apply('Replaced DOM/DAC with official names', /\bDOM\b/g, 'DESS Oud Metha');
  apply('Replaced DOM/DAC with official names', /\bDAC\b/g, 'DESS Academic City');
  apply('"DESS sports kit" → "school sports kit"', /\bDESS (sports? |PE )?kit\b/gi, (_, s) => `school ${s ? 'sports ' : ''}kit`);
  apply('Removed "Yours sincerely/faithfully"', /\n?\s*Yours (sincerely|faithfully),?/gi, '\nKind regards,');

  // Times: 7:45am → 7.45am, 8 am → 8.00am, 8.00AM → 8.00am
  for (const i of checkTimes(t)) if (i.fix) apply(`Time format: ${i.excerpt} → ${i.fix}`, new RegExp(escape(i.excerpt), 'g'), i.fix);

  // Dates: Thursday 17 September → Thursday, 17th September (only when the weekday matches)
  for (const i of checkDates(t, ref).issues)
    if (i.id === 'date-format' && i.fix) apply(`Date format: ${i.excerpt} → ${i.fix}`, new RegExp(escape(i.excerpt), 'g'), i.fix);

  t = t.replace(/\u0001(\d+)\u0001/g, (_, n) => protectedTokens[Number(n)]);
  return { text: t, changes: [...new Set(changes)] };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
