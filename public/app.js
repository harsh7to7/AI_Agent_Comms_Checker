const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let docxBase64 = null;
let lastResult = null;

// ---------- Status ----------
fetch('/api/status')
  .then((r) => r.json())
  .then((s) => {
    const el = $('status');
    el.className = `status ${s.ai ? 'on' : 'off'}`;
    el.textContent = s.ai
      ? `AI on · learning from ${s.examples} example${s.examples === 1 ? '' : 's'} · guidelines ${s.guidelinesVersion}`
      : `AI off (no API key) · rule checks only · guidelines ${s.guidelinesVersion}`;
    if (!s.ai) $('use-ai').checked = false;
  })
  .catch(() => ($('status').textContent = 'Server not reachable'));

// ---------- Character counters ----------
for (const [input, counter] of [['title', 'title-count'], ['desc', 'desc-count']]) {
  const update = () => {
    const n = $(input).value.trim().length;
    $(counter).textContent = `${n}/50`;
    $(counter).classList.toggle('over', n > 50);
  };
  $(input).addEventListener('input', update);
}
const refreshCounts = () => ['title', 'desc'].forEach((id) => $(id).dispatchEvent(new Event('input')));

// Default the send date to two working days from now (48 hours' notice, skipping Fridays/Saturdays).
(() => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while ([5, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  $('send').value = d.toISOString().slice(0, 10);
})();

// ---------- Upload ----------
async function loadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.docx')) return showProgress('Please choose a .docx file.', true);
  const buf = await file.arrayBuffer();
  showProgress('Reading document…');
  const res = await fetch('/api/parse-docx', { method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream' } });
  const data = await res.json();
  if (!res.ok) return showProgress(data.error, true);
  $('title').value = data.title;
  $('desc').value = data.shortDescription;
  $('body').value = data.body;
  refreshCounts();
  docxBase64 = toBase64(buf);
  $('drop').classList.add('loaded');
  $('file-name').textContent = `${file.name} loaded${data.isTemplate ? '' : ' (not the comms template – whole document used as body)'}`;
  showProgress('');
}
function toBase64(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('over')));
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  loadFile(e.dataTransfer.files[0]);
});
// Editing the body by hand means the Word formatting no longer reflects it – keep checking formatting anyway
// since fonts/colours come from the file, but tell the user.
$('body').addEventListener('input', () => {
  if (docxBase64) $('file-name').textContent = 'Formatting is checked from the uploaded file; text from the box below.';
});

function showProgress(text, isError = false) {
  $('progress').textContent = text;
  $('progress').classList.toggle('error', isError);
}

// ---------- Run ----------
$('run').addEventListener('click', async () => {
  const payload = {
    title: $('title').value,
    shortDescription: $('desc').value,
    body: $('body').value,
    school: $('school').value,
    audience: $('audience').value,
    sendDate: $('send').value,
    archiveDate: $('archive').value,
    fromTeacher: $('teacher').checked,
    useAI: $('use-ai').checked,
    docxBase64,
  };
  if (!payload.body.trim()) return showProgress('Add the message body first.', true);
  $('run').disabled = true;
  showProgress('Starting…');
  try {
    const res = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error((await res.json()).error);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.progress) showProgress(msg.progress);
        if (msg.error) throw new Error(msg.error);
        if (msg.result) {
          lastResult = msg.result;
          render(msg.result);
          showProgress(msg.result.notice || '');
        }
      }
    }
  } catch (err) {
    showProgress(err.message, true);
  } finally {
    $('run').disabled = false;
  }
});

// ---------- Rendering ----------
const SEVERITY_ORDER = { error: 0, warning: 1, suggestion: 2, info: 3 };
const FIELD_LABEL = { title: 'Title', description: 'Short description', body: 'Body', format: 'Formatting (Word file)', schedule: 'Send / archive dates' };

function render(r) {
  $('empty').hidden = true;
  $('results').hidden = false;

  const final = r.remainingSummary;
  const status = r.ai?.readiness === 'major_changes' && final.errors ? 'needs-changes' : final.status;
  const headline = {
    ready: 'Ready to submit',
    review: 'Nearly there – review the notes below',
    'needs-changes': 'Changes needed before submitting',
  }[status];
  const orig = r.checkSummary;
  $('verdict').className = `verdict ${status}`;
  $('verdict').innerHTML = `
    <h3>${headline}</h3>
    <p>${esc(r.ai?.summary || `Automated checks found ${orig.errors} error(s) and ${orig.warnings} warning(s) in the draft. Safe fixes have been applied below.`)}</p>
    <div class="counts">
      <span>Draft: <b>${orig.errors}</b> errors · <b>${orig.warnings}</b> warnings</span>
      ${r.ai ? `<span>AI found <b>${r.ai.issues.length}</b> issues</span>` : ''}
      <span>Refined version: <b>${final.errors}</b> errors · <b>${final.warnings}</b> warnings</span>
      ${r.model ? `<span>${esc(r.model)}</span>` : ''}
    </div>`;

  renderPreview();
  renderQuestions(r);
  renderIssues(r);
  renderManual(r.manualChecks);
  $('issue-count').textContent = (r.ai?.issues.length || 0) + r.checks.filter((i) => i.severity !== 'info').length;
  selectTab('refined');
}

function renderPreview() {
  const r = lastResult;
  if (!r) return;
  const ref = r.refined;
  const diff = $('show-diff').checked;
  const tLen = ref.title.length;
  const dLen = ref.short_description.length;
  const meta = `<div class="meta">Title <span class="${tLen > 50 ? 'over' : ''}">${tLen}/50</span> · Description <span class="${dLen > 50 ? 'over' : ''}">${dLen}/50</span></div>`;
  if (diff) {
    $('preview').innerHTML = `${meta}
      <p class="p-title">${diffHtml(r.original.title, ref.title)}</p>
      <p class="p-desc">${diffHtml(r.original.short_description, ref.short_description)}</p>
      <p>${diffHtml(plain(r.original.body), plain(ref.body))}</p>`;
  } else {
    $('preview').innerHTML = `${meta}
      <p class="p-title">${esc(ref.title)}</p>
      <p class="p-desc">${esc(ref.short_description)}</p>
      ${bodyHtml(ref.body)}`;
  }
}
$('show-diff').addEventListener('change', renderPreview);

function renderQuestions(r) {
  const qs = r.ai?.questions || [];
  $('questions').innerHTML = qs.length
    ? `<div class="box q"><h4>Questions for you</h4><ul>${qs.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>`
    : '';
  const remaining = r.remaining.filter((i) => i.severity !== 'info' || ['archive-suggest', 'calendar'].includes(i.id));
  $('remaining').innerHTML = remaining.length
    ? `<div class="box r"><h4>Still to sort out (outside the text, or needs your decision)</h4><ul>${remaining
        .map((i) => `<li><b>${esc(FIELD_LABEL[i.field] || i.field)}:</b> ${esc(i.message)}${i.excerpt ? ` <span class="muted">– “${esc(i.excerpt)}”</span>` : ''}</li>`)
        .join('')}</ul></div>`
    : '';
}

function renderIssues(r) {
  const parts = [];
  if (r.ai?.issues.length) {
    const ai = [...r.ai.issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    parts.push(`<div class="issue-group"><h3>AI review – what was changed and why</h3>${ai
      .map(
        (i) => `<div class="issue ${i.severity}">
          <div class="head"><span class="tag">${esc(i.guideline)}</span><span class="msg">${esc(i.explanation)}</span></div>
          <div class="ex">${i.original ? `<code>${esc(i.original)}</code>` : ''}${i.suggestion ? ` → <code class="fix">${esc(i.suggestion)}</code>` : ''}</div>
        </div>`,
      )
      .join('')}</div>`);
  }
  const groups = {};
  for (const i of [...r.checks].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])) (groups[i.field] ||= []).push(i);
  for (const field of ['title', 'description', 'body', 'format', 'schedule']) {
    if (!groups[field]) continue;
    parts.push(`<div class="issue-group"><h3>Guideline checks – ${FIELD_LABEL[field]}</h3>${groups[field]
      .map(
        (i) => `<div class="issue ${i.severity}">
          <div class="head"><span class="tag">${esc(i.guideline)}</span><span class="msg">${esc(i.message)}</span></div>
          ${i.excerpt || i.fix || i.suggestion ? `<div class="ex">${i.excerpt ? `<code>${esc(i.excerpt)}</code>` : ''}${i.fix || i.suggestion ? ` → <code class="fix">${esc(i.fix || i.suggestion)}</code>` : ''}</div>` : ''}
        </div>`,
      )
      .join('')}</div>`);
  }
  if (r.autoChanges?.length)
    parts.push(`<div class="issue-group"><h3>Automatic fixes applied</h3><ul>${r.autoChanges.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`);
  $('tab-issues').innerHTML = parts.join('') || '<p>No issues found.</p>';
}

function renderManual(items) {
  $('manual').innerHTML = items
    .map((m) => `<li><label><input type="checkbox"><span>${esc(m.text)}${m.guideline ? ` <span class="muted">(${esc(m.guideline)})</span>` : ''}</span></label></li>`)
    .join('');
}

// ---------- Tabs ----------
function selectTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  for (const t of ['refined', 'issues', 'checklist']) $(`tab-${t}`).hidden = t !== name;
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

// ---------- Copy / download ----------
$('copy').addEventListener('click', async () => {
  const r = lastResult.refined;
  const html = `<div style="font-family:Montserrat;font-size:10pt;color:#000">${bodyHtml(r.body)}</div>`;
  const text = `${r.title}\n${r.short_description}\n\n${plain(r.body)}`;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
    ]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
  $('copy').textContent = 'Copied ✓';
  setTimeout(() => ($('copy').textContent = 'Copy text'), 1500);
});

$('download').addEventListener('click', async () => {
  const res = await fetch('/api/export-docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lastResult.refined) });
  if (!res.ok) return showProgress('Could not create the Word file.', true);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(lastResult.refined.title || 'communication').replace(/[^\w\s-]/g, '').trim()} - checked.docx`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- Markup helpers (mirror src/markup.js) ----------
function inlineHtml(line) {
  return esc(line)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) =>
      /^(https?:|mailto:)/i.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : `<u>${t}</u>`)
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\{\{[^}]+\}\}/g, (m) => `<span class="merge">${m}</span>`);
}
function bodyHtml(body) {
  const out = [];
  let list = null;
  for (const raw of body.split('\n')) {
    const bullet = /^\s*[-•]\s+/.test(raw);
    if (bullet) {
      list ||= [];
      list.push(`<li>${inlineHtml(raw.replace(/^\s*[-•]\s+/, ''))}</li>`);
      continue;
    }
    if (list) out.push(`<ul>${list.join('')}</ul>`), (list = null);
    if (raw.trim()) out.push(`<p>${inlineHtml(raw)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}
function plain(body) {
  return body.replace(/\*\*([\s\S]+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1');
}

// Word-level diff (LCS) for "Show changes".
function diffHtml(a, b) {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  const n = A.length;
  const m = B.length;
  if (n * m > 4_000_000) return esc(b);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, out = '';
  while (i < n && j < m) {
    if (A[i] === B[j]) out += esc(A[i++]), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out += `<del>${esc(A[i++])}</del>`;
    else out += `<ins>${esc(B[j++])}</ins>`;
  }
  while (i < n) out += `<del>${esc(A[i++])}</del>`;
  while (j < m) out += `<ins>${esc(B[j++])}</ins>`;
  return out;
}
