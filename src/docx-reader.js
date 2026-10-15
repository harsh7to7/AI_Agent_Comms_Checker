import JSZip from 'jszip';

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decode = (s) =>
  s
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const attr = (xml, tag, name = 'w:val') => {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
};

// <w:b/> is on; <w:b w:val="0"/> or "false" is explicitly off.
const toggle = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?/?>`));
  if (!m) return undefined;
  const v = m[0].match(/w:val="([^"]*)"/);
  return !(v && /^(0|false|off)$/i.test(v[1]));
};

function readRunProps(rPr = '') {
  const props = {};
  const fonts = rPr.match(/<w:rFonts\b[^>]*>/);
  if (fonts) {
    const f = fonts[0];
    const ascii = f.match(/w:ascii="([^"]*)"/) || f.match(/w:hAnsi="([^"]*)"/);
    const theme = f.match(/w:asciiTheme="([^"]*)"/) || f.match(/w:hAnsiTheme="([^"]*)"/);
    if (ascii) props.font = ascii[1];
    else if (theme) props.fontTheme = theme[1];
  }
  const sz = attr(rPr, 'w:sz');
  if (sz) props.size = Number(sz) / 2;
  const color = attr(rPr, 'w:color');
  if (color) props.color = color;
  const highlight = attr(rPr, 'w:highlight');
  if (highlight && highlight !== 'none') props.highlight = highlight;
  for (const [key, tag] of [['bold', 'w:b'], ['italic', 'w:i'], ['caps', 'w:caps']]) {
    const t = toggle(rPr, tag);
    if (t !== undefined) props[key] = t;
  }
  const rStyle = attr(rPr, 'w:rStyle');
  if (rStyle) props.rStyle = rStyle;
  return props;
}

function readStyles(stylesXml = '') {
  const styles = {};
  let defaultParagraphStyle;
  for (const m of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = m[1].match(/w:styleId="([^"]*)"/)?.[1];
    if (!id) continue;
    if (/w:type="paragraph"/.test(m[1]) && /w:default="1"/.test(m[1])) defaultParagraphStyle = id;
    const rPr = m[2].match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1];
    styles[id] = {
      name: attr(m[2], 'w:name'),
      basedOn: attr(m[2], 'w:basedOn'),
      props: readRunProps(rPr),
    };
  }
  const defaults = readRunProps(stylesXml.match(/<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/)?.[1]);
  return { styles, defaultParagraphStyle, defaults };
}

function styleChainProps(styles, id, seen = new Set()) {
  if (!id || !styles[id] || seen.has(id)) return {};
  seen.add(id);
  return { ...styleChainProps(styles, styles[id].basedOn, seen), ...styles[id].props };
}

function readThemeFonts(themeXml = '') {
  return {
    minor: themeXml.match(/<a:minorFont>\s*<a:latin typeface="([^"]*)"/)?.[1],
    major: themeXml.match(/<a:majorFont>\s*<a:latin typeface="([^"]*)"/)?.[1],
  };
}

function runText(runXml) {
  let text = '';
  for (const m of runXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
    if (m[1] !== undefined) text += decode(m[1]);
    else if (m[0] === '<w:tab/>') text += '\t';
    else text += '\n';
  }
  return text;
}

/**
 * Parses a .docx buffer into structured paragraphs with effective run formatting.
 * Understands the DESS "Communication Template" layout (Title / Short Description / Body of the text).
 */
export async function readDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (p) => (zip.file(p) ? zip.file(p).async('string') : '');
  const [doc, stylesXml, themeXml, relsXml] = await Promise.all([
    read('word/document.xml'),
    read('word/styles.xml'),
    read('word/theme/theme1.xml'),
    read('word/_rels/document.xml.rels'),
  ]);
  if (!doc) throw new Error('Not a valid .docx file (word/document.xml missing).');

  const { styles, defaultParagraphStyle, defaults } = readStyles(stylesXml);
  const theme = readThemeFonts(themeXml);
  const rels = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]*)"/)?.[1];
    const target = m[0].match(/Target="([^"]*)"/)?.[1];
    if (id) rels[id] = decode(target || '');
  }

  // Table ranges so we can tag paragraphs that live in tables.
  const tableRanges = [];
  for (const m of doc.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)) tableRanges.push([m.index, m.index + m[0].length]);
  const inTable = (i) => tableRanges.some(([a, b]) => i >= a && i < b);

  const paragraphs = [];
  const paraRe = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  for (const pm of doc.matchAll(paraRe)) {
    const pXml = pm[0];
    const pPr = pXml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] || '';
    const pStyle = attr(pPr, 'w:pStyle') || defaultParagraphStyle;
    const isList = /<w:numPr>/.test(pPr) || /List/i.test(styles[pStyle]?.name || '');
    const base = { ...defaults, ...styleChainProps(styles, pStyle) };
    const runs = [];
    let images = 0;

    const tokenRe = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
    const pushRun = (rXml, link) => {
      if (/<w:drawing>|<w:pict>/.test(rXml)) images++;
      const text = runText(rXml);
      if (!text) return;
      const direct = readRunProps(rXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1]);
      const p = { ...base, ...styleChainProps(styles, direct.rStyle), ...direct };
      let font = p.font;
      if (!font && p.fontTheme) font = /major/i.test(p.fontTheme) ? theme.major : theme.minor;
      runs.push({
        text,
        font: font || 'unknown',
        size: p.size ?? 11,
        color: p.color && !/^auto$/i.test(p.color) ? p.color.toUpperCase() : '000000',
        bold: !!p.bold,
        italic: !!p.italic,
        caps: !!p.caps,
        highlight: p.highlight,
        link,
      });
    };
    for (const tm of pXml.matchAll(tokenRe)) {
      if (tm[1] !== undefined) {
        const rid = tm[1].match(/r:id="([^"]*)"/)?.[1];
        const anchor = tm[1].match(/w:anchor="([^"]*)"/)?.[1];
        const link = rid ? rels[rid] : anchor ? `#${anchor}` : '';
        for (const rm of tm[2].matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) pushRun(rm[0], link || '(link)');
      } else {
        pushRun(tm[0], null);
      }
    }
    paragraphs.push({
      text: runs.map((r) => r.text).join(''),
      isList,
      inTable: inTable(pm.index),
      images,
      runs,
    });
  }

  return splitTemplate(paragraphs);
}

const LABELS = {
  title: /^\s*title\s*(\([^)]*\))?\s*:/i,
  description: /^\s*short\s+description\s*(\([^)]*\))?\s*:/i,
  body: /^\s*body of the text/i,
};

/** Splits paragraphs into title, short description and body using the template labels. */
function splitTemplate(paragraphs) {
  let title = '';
  let shortDescription = '';
  let bodyStart = -1;

  const valueAfterLabel = (i, re) => {
    const inline = paragraphs[i].text.replace(re, '').trim();
    if (inline) return inline;
    const next = paragraphs.slice(i + 1).find((p) => p.text.trim());
    return next ? next.text.trim() : '';
  };

  paragraphs.forEach((p, i) => {
    if (!title && LABELS.title.test(p.text)) title = valueAfterLabel(i, LABELS.title);
    else if (!shortDescription && LABELS.description.test(p.text))
      shortDescription = valueAfterLabel(i, LABELS.description);
    else if (bodyStart < 0 && LABELS.body.test(p.text)) bodyStart = i + 1;
  });

  const isTemplate = bodyStart >= 0;
  let bodyParas = isTemplate ? paragraphs.slice(bodyStart) : paragraphs;
  // Trim leading/trailing empty paragraphs.
  while (bodyParas.length && !bodyParas[0].text.trim()) bodyParas = bodyParas.slice(1);
  while (bodyParas.length && !bodyParas.at(-1).text.trim()) bodyParas = bodyParas.slice(0, -1);

  return {
    isTemplate,
    title,
    shortDescription,
    body: paragraphsToText(bodyParas),
    bodyMarked: paragraphsToMarkup(bodyParas),
    paragraphs: bodyParas,
  };
}

export function paragraphsToText(paras) {
  return paras.map((p) => (p.isList ? '- ' : '') + p.text.replace(/\n/g, ' ')).join('\n');
}

/** Light markup the AI can read: **bold**, [text](link), "- " bullets. */
export function paragraphsToMarkup(paras) {
  return paras
    .map((p) => {
      let out = '';
      let i = 0;
      while (i < p.runs.length) {
        const r = p.runs[i];
        if (r.link) {
          let text = '';
          const link = r.link;
          while (i < p.runs.length && p.runs[i].link === link) text += p.runs[i++].text;
          out += `[${text}](${link})`;
          continue;
        }
        let text = '';
        const bold = r.bold;
        while (i < p.runs.length && !p.runs[i].link && p.runs[i].bold === bold) text += p.runs[i++].text;
        out += bold && text.trim() ? `**${text}**` : text;
      }
      return (p.isList ? '- ' : '') + out.replace(/\n/g, ' ');
    })
    .join('\n');
}
