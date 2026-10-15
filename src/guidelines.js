// Source: "Communication Checker Guidelines (last updated 21.9.26).pdf"
// Rule numbers (G1–G33) match the numbered list in the PDF so reviewers can cross-reference.

export const GUIDELINES_VERSION = '21.9.26';

export const SCHOOLS = {
  'oud-metha': { name: 'DESS Oud Metha', short: 'Oud Metha', phase: 'primary' },
  'academic-city': { name: 'DESS Academic City', short: 'Academic City', phase: 'primary' },
  college: { name: 'DESS College', short: 'the College', phase: 'secondary' },
  all: { name: 'DESS (all schools)', short: 'DESS', phase: 'mixed' },
};

export const MERGE_FIELDS = [
  '{{student.forename}}',
  '{{student.forename_apostrophe_s}}',
  '{{student.his/student.her}}',
  '{{student.His/student.Her}}',
  '{{student.him/student.her}}',
  '{{student.Him/student.Her}}',
  '{{student.himself/student.herself}}',
  '{{student.He/student.She}}',
  '{{student.he/student.she}}',
  '{{pupil.txtacademichouse}}',
];

export const TITLE_MAX = 50;
export const DESCRIPTION_MAX = 50;

export const GUIDELINES_TEXT = `
DESS COMMUNICATION CHECKER GUIDELINES (last updated 21.9.26)
The DESS App is the primary platform for parent communication across the primary schools and the College.

REQUEST FORM / PROCESS
- The SLT member selected must approve the message BEFORE it is submitted.
- Whole school / full year group / full class / full set / full form audiences need no Excel list.
- Give as much notice as possible: ideally 48 hours. Avoid communication going out on a Friday.
- Archive date: if the message is about an event, archive the day AFTER the event. Do not keep messages live longer than necessary (e.g. not to the end of term).
- 1–3 reminders may be set.
- Selected-student lists: Excel template, one tab, alphabetical by surname, iSAMS surname + official iSAMS first name (not preferred name) + class/form. Two schools = two separate spreadsheets.
- Message: Word template. Title and short description each within 50 characters, and different from each other. Year-group-specific messages start the title with the year group, e.g. "Y10 Portugal Trip".

NAMING OUR SCHOOLS
- DESS Oud Metha (may be shortened to Oud Metha). NEVER "DOM".
- DESS Academic City (may be shortened to Academic City). NEVER "DAC".
- DESS College (may be shortened to the College).
- "DESS" on its own only when referring to the family of schools. Avoid DAC, DOM, DESC, DESS Primary, DESS AC/OM, "DESS Schools".

COMMUNICATION GUIDELINES
1. Allow 48 hours' notice; avoid Friday sends.
2. Check all spelling, grammar and tone.
3. Title max 50 characters.
4. Font is Montserrat; all text (including merge fields) the same font size.
5. Any event date must be in the parent calendar.
6. Updates: email first, then resubmit the full form.
7. Recurring communications should follow a consistent template.

BODY OF THE TEXT
G8. Title and short description different and within the character limit. (a) No '&' in the title. (b) Consider making the short description a date, e.g. "Wednesday, 7th January".
G9. Concise, clear and parent-friendly. Avoid phrases like "I hope this email finds you well" or "If you are receiving this letter...".
G10. Do not start with "Dear Parent", "Dear Sports parents" etc.
G11. Black text only. No other colour (e.g. red). Use bold to highlight key points.
G12. Hyperlinks within the body text (not in images or separate documents).
G13. Check links work (e.g. open the Microsoft Form in an incognito window).
G14. Write "at" instead of "@" (e.g. "at DESS Academic City").
G15. Only one space after a full stop.
G16. No QR codes in the body, only links.
G17. Bullet points only. No emojis or symbols.
G18. Money as AED3000 – no space between AED and the number, nothing after the number.
G19. No capital letters (all-caps text) or red text anywhere – body or title.
G20. No unnecessary spacing between details; use a colon, e.g. "Time: 8.00am".
G21. Emphasise key details in bold (date, location etc.).
G22. British English only, no American English.
G23. Refer to "children" (not students/pupils) at the primaries (Oud Metha, Academic City), and "students" at the College.
G24. Links read "please fill out the form HERE" with the hyperlink on the word HERE.
G25. Attachments only as PDF files (no PowerPoints, no Word files).
G26. Dates written in full, e.g. "Thursday, 6th November", not "6/11/25".
G27. Dates read "Thursday, 6th November" – comma after the day, ordinal suffix on the number.
G28. No 24-hour clock; times written "7.45am" not "7:45am".
G29. No sign-off unless sent by an individual teacher, in which case:
     Kind regards,
     Mr/Mrs/Miss Surname (no dot after Mr/Mrs/Ms/Miss/Dr)
     Job title
     Never "Yours faithfully" / "Yours sincerely".
G30. Check that dates in the message (e.g. deadlines) have not already passed.
G31. Attachments named correctly and on school templates.
G32. Use the Microsoft Forms template; times/dates on the form must match the body text.
G33. PE/Sport kit: say "school kit" or "school sports kit", not "DESS sports kit".

PERSONALISATION / MERGE FIELDS
- Merge fields in every communication unless the audience is the whole school.
- Address the parent directly: replace "parent" with "you" wherever possible.
- Replace "your child", "your son/daughter", "they", "their" etc. with the correct merge field.
- Merge field formatting must match neighbouring text (bold/italic), with exactly one space after it.
- Available merge fields: ${MERGE_FIELDS.join(', ')}.
`.trim();

// House-style patterns observed in the comms team's own edits (version 1 → version 2 examples).
export const HOUSE_STYLE_NOTES = `
OBSERVED HOUSE STYLE (from the Marketing & Communications team's edits)
- "Parents' Evening" takes an apostrophe.
- Plural acronyms take no apostrophe: "ECAs", not "ECA's".
- Name the specific school rather than bare "DESS" ("At DESS Oud Metha, we value...", "New to DESS Oud Metha parents").
- "Click HERE to find out more", "sign up via the link HERE" – HERE in capitals carries the hyperlink.
- No space before a colon: "Art (Mrs Muir): Years 4, 5, 6".
- Schedule entries: "Thursday, 17th September" / "8.15am | Gym" / "Mrs Hussain (SENCO)".
- Headings are short, in sentence or title case, never all caps.
`.trim();

// Things only a human can confirm; shown as a manual checklist alongside automated results.
export const MANUAL_CHECKS = [
  { id: 'M1', text: 'The selected SLT member has approved this exact message.' },
  { id: 'M2', text: 'Every link has been opened in an incognito window and works.', guideline: 'G13' },
  { id: 'M3', text: 'Every event date in the message is in the parent calendar.', guideline: '5' },
  { id: 'M4', text: 'Microsoft Form dates/times match the body text exactly.', guideline: 'G32' },
  { id: 'M5', text: 'Attachments are branded PDFs on the school template and named correctly.', guideline: 'G25/G31' },
  { id: 'M6', text: 'For selected students: one-tab Excel list from iSAMS, sorted by surname, no duplicates.' },
  { id: 'M7', text: 'Coordinated send date with other messages from your department(s).' },
];
