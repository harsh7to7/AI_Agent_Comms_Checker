import './src/env.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocx } from './src/docx-reader.js';
import { reviewMessage, aiAvailable, MODEL } from './src/agent.js';
import { buildDocx } from './src/docx-writer.js';
import { stripMarkup } from './src/markup.js';
import { loadExamples } from './src/examples.js';
import { GUIDELINES_VERSION } from './src/guidelines.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 15 * 1024 * 1024;

const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/dess-logo.webp': 'dess-logo.webp' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Upload too large (max 15MB).'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

async function toMessage(input) {
  const msg = {
    title: input.title || '',
    shortDescription: input.shortDescription || '',
    bodyMarked: input.body || '',
    body: stripMarkup(input.body || ''),
    school: input.school,
    audience: input.audience,
    sendDate: input.sendDate,
    archiveDate: input.archiveDate,
    fromTeacher: Boolean(input.fromTeacher),
  };
  // Formatting (font, colour, size) can only be checked on the original Word file.
  if (input.docxBase64) {
    const parsed = await readDocx(Buffer.from(input.docxBase64, 'base64'));
    msg.paragraphs = parsed.paragraphs;
  }
  return msg;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const file = path.join(ROOT, 'public', STATIC[url.pathname]);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] });
      return fs.createReadStream(file).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const examples = await loadExamples();
      return json(res, 200, { ai: aiAvailable(), model: aiAvailable() ? MODEL : null, examples: examples.length, guidelinesVersion: GUIDELINES_VERSION });
    }

    if (req.method === 'POST' && url.pathname === '/api/parse-docx') {
      const buf = await readBody(req);
      const d = await readDocx(buf);
      return json(res, 200, { title: d.title, shortDescription: d.shortDescription, body: d.bodyMarked, isTemplate: d.isTemplate });
    }

    if (req.method === 'POST' && url.pathname === '/api/review') {
      const input = JSON.parse((await readBody(req)).toString('utf8'));
      const msg = await toMessage(input);
      // Stream newline-delimited JSON so the page can show progress during the AI call.
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
      const send = (o) => res.write(JSON.stringify(o) + '\n');
      try {
        const result = await reviewMessage(msg, { useAI: input.useAI !== false, onProgress: (step) => send({ progress: step }) });
        send({ result });
      } catch (err) {
        console.error(err);
        send({ error: friendlyError(err) });
      }
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/api/export-docx') {
      const input = JSON.parse((await readBody(req)).toString('utf8'));
      const buf = await buildDocx(input);
      const name = (input.title || 'communication').replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'communication';
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${name} - checked.docx"`,
      });
      return res.end(buf);
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, err.status || 400, { error: friendlyError(err) });
    else res.end();
  }
});

function friendlyError(err) {
  if (err?.status === 401) return 'The AI API key is invalid. Check ANTHROPIC_API_KEY / GEMINI_API_KEY in .env.';
  if (err?.status === 429) return 'The AI service is busy (rate limited). Please wait a minute and try again.';
  if (err?.status >= 500) return 'The AI service is temporarily unavailable. Please try again shortly.';
  return err?.message || 'Something went wrong.';
}

server.listen(PORT, () => {
  console.log(`DESS Comms Checker running at http://localhost:${PORT}`);
  console.log(aiAvailable() ? `AI refinement: on (${MODEL})` : 'AI refinement: off – set ANTHROPIC_API_KEY or GEMINI_API_KEY in .env to enable. Rule checks still work.');
});
