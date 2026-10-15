// The refined body uses a tiny markup: **bold**, [HERE](https://…) links, and "- " bullet lines.

/** Splits one line into segments: { text, bold, link }. */
export function parseLine(line) {
  const segments = [];
  const re = /\*\*([\s\S]+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index), bold: false });
    if (m[1] !== undefined) {
      // Links may sit inside bold text.
      for (const inner of parseLine(m[1])) segments.push({ ...inner, bold: true });
    } else {
      segments.push({ text: m[2], bold: false, link: m[3] });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), bold: false });
  return segments;
}

export function parseBody(body) {
  return (body || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((raw) => {
      const bullet = /^\s*[-•*]\s+/.test(raw) && !/^\s*\*\*/.test(raw);
      const line = bullet ? raw.replace(/^\s*[-•*]\s+/, '') : raw;
      return { bullet, segments: parseLine(line), empty: !line.trim() };
    });
}

/** Plain text for rule checking ("- " kept for bullets). */
export function stripMarkup(body) {
  return parseBody(body)
    .map((l) => (l.bullet ? '- ' : '') + l.segments.map((s) => s.text).join(''))
    .join('\n');
}

export function extractLinks(body) {
  return parseBody(body).flatMap((l) => l.segments.filter((s) => s.link).map((s) => ({ text: s.text, url: s.link })));
}
