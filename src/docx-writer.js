import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, LevelFormat, AlignmentType } from 'docx';
import { parseBody } from './markup.js';

const FONT = 'Montserrat';
const SIZE = 20; // half-points → 10pt, matching the comms template

const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: SIZE, color: '000000', ...opts });

/** Builds a .docx in the DESS Communication Template layout from a refined message. */
export async function buildDocx({ title, short_description, body }) {
  const children = [
    new Paragraph({ children: [run('Communication Template', { bold: true, size: 36 })], spacing: { after: 240 } }),
    new Paragraph({ children: [run('Title (50 characters max): ', { bold: true }), run(title || '')], spacing: { after: 120 } }),
    new Paragraph({ children: [run('Short Description (50 characters max): ', { bold: true }), run(short_description || '')], spacing: { after: 120 } }),
    new Paragraph({ children: [run('Body of the text (copy and paste below):', { bold: true })], spacing: { after: 240 } }),
  ];

  const lines = parseBody(body);
  lines.forEach((line, i) => {
    if (line.empty) return; // paragraph spacing replaces blank lines
    const nextEmpty = !lines[i + 1] || lines[i + 1].empty;
    children.push(
      new Paragraph({
        numbering: line.bullet ? { reference: 'bullets', level: 0 } : undefined,
        spacing: { after: line.bullet && !nextEmpty ? 0 : 160 },
        children: line.segments.map((s) =>
          s.link
            ? new ExternalHyperlink({ link: s.link, children: [run(s.text, { bold: s.bold, underline: {} })] })
            : run(s.text, { bold: s.bold }),
        ),
      }),
    );
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE, color: '000000' } } } },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
