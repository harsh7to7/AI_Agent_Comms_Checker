import Anthropic from '@anthropic-ai/sdk';
import { GUIDELINES_TEXT, HOUSE_STYLE_NOTES, MANUAL_CHECKS, SCHOOLS, MERGE_FIELDS } from './guidelines.js';
import { runRules, summarise } from './rules.js';
import { autoFix } from './autofix.js';
import { stripMarkup } from './markup.js';
import { loadExamples, formatExamples } from './examples.js';
import { formatDate, parseISODate, todayUTC } from './dates.js';

// Provider: Gemini when GEMINI_API_KEY is set (unless AI_PROVIDER=anthropic), otherwise Claude.
const PROVIDER = process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'anthropic');
export const MODEL =
  PROVIDER === 'gemini' ? process.env.GEMINI_MODEL || 'gemini-flash-latest' : process.env.COMMS_MODEL || 'claude-opus-5-5';
const MAX_FIX_ROUNDS = 2;

// Rule findings the writer can fix by editing text (schedule/format issues are form or Word settings).
const TEXT_FIELDS = new Set(['title', 'description', 'body']);
const NOT_TEXT_FIXABLE = new Set(['calendar', 'archive-suggest', 'date-past', 'merge-missing', 'address-you', 'desc-date', 'money-comma', 'date-weekday']);

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'readiness', 'issues', 'refined', 'questions_for_sender'],
  properties: {
    summary: { type: 'string', description: 'Two or three sentences on the overall state of the draft.' },
    readiness: { type: 'string', enum: ['ready', 'minor_changes', 'major_changes'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['guideline', 'severity', 'category', 'original', 'suggestion', 'explanation'],
        properties: {
          guideline: { type: 'string', description: 'Guideline reference, e.g. "G27" or "Naming".' },
          severity: { type: 'string', enum: ['error', 'warning', 'suggestion'] },
          category: {
            type: 'string',
            enum: ['spelling', 'grammar', 'tone', 'clarity', 'house-style', 'dates-times', 'school-names', 'personalisation', 'links', 'formatting', 'accuracy', 'other'],
          },
          original: { type: 'string', description: 'Exact text from the draft (short).' },
          suggestion: { type: 'string', description: 'Replacement text.' },
          explanation: { type: 'string' },
        },
      },
    },
    refined: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'short_description', 'body'],
      properties: {
        title: { type: 'string' },
        short_description: { type: 'string' },
        body: { type: 'string' },
      },
    },
    questions_for_sender: { type: 'array', items: { type: 'string' } },
  },
};

async function systemPrompt() {
  const examples = await loadExamples();
  return `You are the DESS Communications Checker: an expert editor in the Marketing & Communications team at DESS (Dubai English Speaking School family of schools). Staff submit draft parent messages for the DESS App. You check each draft against the official guidelines and return a corrected, publish-ready version.

<guidelines>
${GUIDELINES_TEXT}
</guidelines>

<house_style>
${HOUSE_STYLE_NOTES}
</house_style>

<before_and_after_examples>
These are real drafts and the comms team's edited versions. Learn the editing style from them. The edited versions are not perfect – some still break the guidelines (for example "Monday. 28th September", red text, "ECA's", "find then"). Always follow the guidelines over the examples.

${formatExamples(examples)}
</before_and_after_examples>

<how_to_edit>
- Keep every fact unchanged: names, dates, times, places, prices, year groups, links and email addresses. Never invent information. If something is missing or ambiguous, leave it and add a question for the sender.
- If a weekday does not match its date, do not guess which one is right. Keep the text, report it as an error, and ask the sender.
- Fix spelling, grammar, punctuation and tone. Make the message concise, warm and parent-friendly. Do not rewrite sections that already read well – a light touch is better.
- Apply every guideline: dates as "Thursday, 6th November"; times as "7.45am"; "at" not "@"; one space after a full stop; no space before a colon; Mr/Mrs/Ms with no full stop; British English; official school names; no all-caps words (except HERE and normal acronyms); no emojis or symbols; money as AED3000; no "Dear Parent" opening; no stock phrases; no sign-off unless from an individual teacher ("Kind regards," then name with no dot, then job title).
- Children vs students: "children" at DESS Oud Metha and DESS Academic City, "students" at DESS College.
- Personalisation: if the audience is not the whole school, replace "your child" / "your son or daughter" / "their" with merge fields, choosing correct grammar. Available merge fields: ${MERGE_FIELDS.join(' ')}. Exactly one space either side of a merge field.
- Links: the link text must be HERE, e.g. "Please fill out the form [HERE](url)." Keep the original URL exactly. If the draft says "here" but has no URL, write HERE and ask the sender for the link.
- Title: at most 50 characters, no "&", different from the short description. If the message is for one year group, start the title with it (e.g. "Y10 Portugal Trip"). Short description: at most 50 characters, ideally the key date (e.g. "Wednesday, 7th January").
- Emphasise key details (dates, times, locations, deadlines) in bold.
</how_to_edit>

<output_format>
Return JSON matching the schema.
- issues: every problem you found and fixed or need the sender to resolve. Quote the original text exactly. One issue per distinct problem (group repeated identical fixes into one issue, e.g. "7 dates missing comma/ordinal").
- refined.body uses this markup only: **bold**, [HERE](url) for links, lines starting "- " for bullet points, one blank line between paragraphs. No headings markup (#), no italics, no HTML.
- questions_for_sender: things only the sender can confirm (missing links, mismatched dates, unclear details). Do not include generic process reminders.
</output_format>`;
}

function userPrompt(msg, ruleIssues) {
  const school = SCHOOLS[msg.school]?.name || 'not specified';
  const audience = {
    'whole-school': 'whole school (no merge fields needed)',
    'year-group': 'a full year group',
    class: 'a full class/form/set',
    selected: 'selected students (Excel list)',
  }[msg.audience] || 'not specified';
  const send = parseISODate(msg.sendDate);
  const findings = ruleIssues
    .filter((i) => i.severity !== 'info' && i.field !== 'schedule')
    .map((i) => `- [${i.severity}] ${i.guideline}: ${i.message}${i.excerpt ? ` → "${i.excerpt}"` : ''}${i.fix ? ` (fix: "${i.fix}")` : ''}`)
    .join('\n');

  return `<context>
School: ${school}
Audience: ${audience}
From an individual teacher (sign-off allowed): ${msg.fromTeacher ? 'yes' : 'no'}
Planned send date: ${send ? `${formatDate(send)} ${send.getUTCFullYear()}` : 'not given'}
Today: ${formatDate(todayUTC())} ${todayUTC().getUTCFullYear()}
</context>

<draft>
Title: ${msg.title || '(none)'}
Short description: ${msg.shortDescription || '(none)'}
Body:
${msg.bodyMarked || msg.body}
</draft>

<automated_checker_findings>
These were found by the rule-based checker. Make sure each one is resolved in your refined version (or explained in issues/questions if it cannot be fixed by editing text).
${findings || '(none)'}
</automated_checker_findings>

Check this draft and return the refined version.`;
}

function getClient() {
  if (PROVIDER === 'gemini') return process.env.GEMINI_API_KEY ? { provider: 'gemini' } : null;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  return new Anthropic();
}

export function aiAvailable() {
  return getClient() !== null;
}

/** Sends the conversation to the configured provider; returns the parsed JSON and the assistant turn to replay. */
function callAI(client, system, messages) {
  return client.provider === 'gemini' ? callGemini(system, messages) : callClaude(client, system, messages);
}

async function callClaude(client, system, messages) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') throw new Error('The AI declined to process this message. Please review it manually.');
  if (response.stop_reason === 'max_tokens') throw new Error('The AI response was cut off (message too long). Try a shorter draft.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { parsed: parseJSON(text), assistantContent: response.content, usage: response.usage };
}

async function callGemini(system, messages) {
  // The free tier often returns 429/503 under load, so retry with backoff.
  let res;
  for (const wait of [2000, 5000, 10000, 0]) {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: RESULT_SCHEMA, maxOutputTokens: 32000 },
      }),
    });
    if (!(res.status === 429 || res.status >= 500) || !wait) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const invalidKey = /API_KEY_INVALID|API key not valid/i.test(JSON.stringify(data));
    const err = new Error(data.error?.message || `Gemini request failed (HTTP ${res.status}).`);
    err.status = invalidKey ? 401 : res.status;
    throw err;
  }
  const candidate = data.candidates?.[0];
  if (!candidate || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(candidate.finishReason))
    throw new Error('The AI declined to process this message. Please review it manually.');
  if (candidate.finishReason === 'MAX_TOKENS') throw new Error('The AI response was cut off (message too long). Try a shorter draft.');
  const text = (candidate.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  return { parsed: parseJSON(text), assistantContent: text, usage: data.usageMetadata };
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The AI returned an unreadable response. Please try again.');
  }
}

/** Checks a refined version with the rule engine and returns what still needs text fixes. */
function recheck(msg, refined) {
  const fixed = autoFix(refined.body, { sendDate: msg.sendDate });
  const candidate = { ...refined, body: fixed.text };
  const issues = runRules({
    ...msg,
    title: candidate.title,
    shortDescription: candidate.short_description,
    body: stripMarkup(candidate.body),
    paragraphs: undefined,
  });
  const blocking = issues.filter(
    (i) => TEXT_FIELDS.has(i.field) && i.severity !== 'info' && !NOT_TEXT_FIXABLE.has(i.id) && !(i.id === 'link-here' && /HERE/.test(i.excerpt || '')),
  );
  return { candidate, issues, blocking, autoChanges: fixed.changes };
}

/**
 * Full review: rule checks → AI refinement → re-check → targeted fix rounds.
 * @param {object} msg { title, shortDescription, body, bodyMarked?, paragraphs?, school, audience, sendDate, archiveDate, fromTeacher }
 * @param {{ useAI?: boolean, onProgress?: (step: string) => void }} opts
 */
export async function reviewMessage(msg, { useAI = true, onProgress = () => {} } = {}) {
  onProgress('Running guideline checks…');
  const originalIssues = runRules(msg);
  const client = useAI ? getClient() : null;

  const result = {
    original: { title: msg.title || '', short_description: msg.shortDescription || '', body: msg.bodyMarked || msg.body || '' },
    checks: originalIssues,
    checkSummary: summarise(originalIssues),
    manualChecks: MANUAL_CHECKS,
    mode: client ? 'ai' : 'rules-only',
    model: client ? MODEL : null,
  };

  if (!client) {
    const fixed = autoFix(msg.bodyMarked || msg.body || '', { sendDate: msg.sendDate });
    const refined = { title: (msg.title || '').replace(/\s*&\s*/g, ' and '), short_description: msg.shortDescription || '', body: fixed.text };
    const after = recheck(msg, refined);
    return {
      ...result,
      notice: useAI ? 'AI refinement is off (no ANTHROPIC_API_KEY or GEMINI_API_KEY set). Showing rule checks and safe automatic fixes only.' : undefined,
      ai: null,
      refined: after.candidate,
      autoChanges: fixed.changes,
      remaining: after.issues,
      remainingSummary: summarise(after.issues),
    };
  }

  const system = await systemPrompt();
  const messages = [{ role: 'user', content: userPrompt(msg, originalIssues) }];

  onProgress('AI is reviewing and refining the message…');
  let { parsed, assistantContent, usage } = await callAI(client, system, messages);
  let after = recheck(msg, parsed.refined);
  let rounds = 0;

  while (after.blocking.length && rounds < MAX_FIX_ROUNDS) {
    rounds++;
    onProgress(`Verifying refined version – fixing ${after.blocking.length} remaining issue(s) (round ${rounds})…`);
    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({
      role: 'user',
      content: `The automated checker still finds these problems in your refined version:\n${after.blocking
        .map((i) => `- ${i.guideline}: ${i.message}${i.excerpt ? ` → "${i.excerpt}"` : ''}`)
        .join('\n')}\n\nFix them (or, if a finding is a false positive, leave the text and say why in questions_for_sender). Return the complete JSON again, keeping all earlier issues.`,
    });
    ({ parsed, assistantContent, usage } = await callAI(client, system, messages));
    after = recheck(msg, parsed.refined);
  }

  onProgress('Done.');
  return {
    ...result,
    ai: { summary: parsed.summary, readiness: parsed.readiness, issues: parsed.issues, questions: parsed.questions_for_sender, fixRounds: rounds },
    refined: after.candidate,
    autoChanges: after.autoChanges,
    remaining: after.issues,
    remainingSummary: summarise(after.issues),
    usage,
  };
}
