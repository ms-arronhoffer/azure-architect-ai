import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  LevelFormat,
} from "docx";

// Exported so reviewDocxExport can reuse it for table cell content
export function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      runs.push(new TextRun(text.slice(last, match.index)));
    }
    if (match[2] !== undefined) {
      runs.push(new TextRun({ text: match[2], bold: true }));
    } else if (match[3] !== undefined) {
      runs.push(new TextRun({ text: match[3], italics: true }));
    } else if (match[4] !== undefined) {
      runs.push(new TextRun({ text: match[4], font: "Courier New", size: 18 }));
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    runs.push(new TextRun(text.slice(last)));
  }
  return runs.length ? runs : [new TextRun(text)];
}

function parseMarkdownTable(lines: string[]): Table | null {
  if (lines.length < 3) return null;
  const parseRow = (line: string) =>
    line.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);

  const headers = parseRow(lines[0]);
  const dataRows = lines.slice(2).map(parseRow);
  const colCount = headers.length || 1;
  const tableWidth = 9360; // US Letter content width in DXA
  const colWidth = Math.floor(tableWidth / colCount);
  const colWidths = headers.map(() => colWidth);

  const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
  const borders = { top: border, bottom: border, left: border, right: border };

  const makeCell = (text: string, isHeader = false, idx = 0): TableCell =>
    new TableCell({
      children: [new Paragraph({
        children: isHeader
          ? [new TextRun({ text, bold: true })]
          : parseInline(text),
        alignment: AlignmentType.LEFT,
      })],
      width: { size: colWidths[idx] ?? colWidth, type: WidthType.DXA },
      shading: isHeader ? { type: ShadingType.CLEAR, fill: "D5E8F0" } : undefined,
      borders,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ children: headers.map((h, idx) => makeCell(h, true, idx)), tableHeader: true }),
      ...dataRows.map(row =>
        new TableRow({ children: row.map((c, idx) => makeCell(c, false, idx)) })
      ),
    ],
  });
}

export function markdownToDocxChildren(markdown: string): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  // Track whether we're in a numbered-list block so that immediately following
  // bullet lines are rendered indented (level 1) as sub-items.
  let afterNumberedItem = false;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      afterNumberedItem = false;
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      for (const cl of codeLines) {
        result.push(new Paragraph({
          children: [new TextRun({ text: cl || " ", font: "Courier New", size: 18 })],
        }));
      }
      continue;
    }

    // Table — collect contiguous pipe-delimited lines
    if (line.startsWith("|")) {
      afterNumberedItem = false;
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const table = parseMarkdownTable(tableLines);
      if (table) {
        result.push(table);
        result.push(new Paragraph({ text: "" }));
      }
      continue;
    }

    // Headings — check most-specific (h5→h4→h3→h2→h1) to avoid partial prefix matches
    const h5m = /^##### (.+)/.exec(line);
    const h4m = /^#### (.+)/.exec(line);
    const h3m = /^### (.+)/.exec(line);
    const h2m = /^## (.+)/.exec(line);
    const h1m = /^# (.+)/.exec(line);
    if (h5m) {
      afterNumberedItem = false;
      result.push(new Paragraph({ children: parseInline(h5m[1]), heading: HeadingLevel.HEADING_5 }));
      i++; continue;
    }
    if (h4m) {
      afterNumberedItem = false;
      result.push(new Paragraph({ children: parseInline(h4m[1]), heading: HeadingLevel.HEADING_4 }));
      i++; continue;
    }
    if (h3m) {
      afterNumberedItem = false;
      result.push(new Paragraph({ children: parseInline(h3m[1]), heading: HeadingLevel.HEADING_3 }));
      i++; continue;
    }
    if (h2m) {
      afterNumberedItem = false;
      result.push(new Paragraph({ children: parseInline(h2m[1]), heading: HeadingLevel.HEADING_2 }));
      i++; continue;
    }
    if (h1m) {
      afterNumberedItem = false;
      result.push(new Paragraph({ children: parseInline(h1m[1]), heading: HeadingLevel.HEADING_1 }));
      i++; continue;
    }

    // Horizontal rule
    if (/^[-*]{3,}$/.test(line.trim())) {
      afterNumberedItem = false;
      result.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } },
        children: [],
      }));
      i++; continue;
    }

    // Blockquote
    const bq = /^> (.*)/.exec(line);
    if (bq) {
      afterNumberedItem = false;
      result.push(new Paragraph({
        children: [new TextRun({ text: bq[1], italics: true, color: "555555" })],
        indent: { left: 360 },
      }));
      i++; continue;
    }

    // Ordered list — preserve the actual number from the markdown as text so
    // numbers like "6." don't get reset to "1." by docx auto-numbering.
    const olm = /^(\d+)\. (.+)/.exec(line);
    if (olm) {
      afterNumberedItem = true;
      result.push(new Paragraph({
        children: [
          new TextRun({ text: `${olm[1]}.` }),
          new TextRun({ text: "\t" }),
          ...parseInline(olm[2]),
        ],
        indent: { left: 720, hanging: 360 },
      }));
      i++; continue;
    }

    // Unordered list — render at level 1 (indented) when following a numbered item,
    // or when the line itself has leading whitespace (explicit indent from the AI).
    const ulm = /^([ \t]*)[-*] (.+)/.exec(line);
    if (ulm) {
      const isIndented = ulm[1].length >= 2;
      const level = (afterNumberedItem || isIndented) ? 1 : 0;
      result.push(new Paragraph({
        children: parseInline(ulm[2]),
        numbering: { reference: "bullets", level },
      }));
      i++; continue;
      // Note: afterNumberedItem stays true — blank lines between sub-bullets
      // and the next sub-bullet under the same numbered item should NOT reset it.
    }

    // Empty line — intentionally does NOT reset afterNumberedItem because
    // sub-bullets under numbered items are often separated by blank lines.
    if (line.trim() === "") {
      result.push(new Paragraph({ text: "" }));
      i++; continue;
    }

    // Normal paragraph — resets the numbered-item context
    afterNumberedItem = false;
    result.push(new Paragraph({ children: parseInline(line), alignment: AlignmentType.LEFT }));
    i++;
  }

  return result;
}

export async function exportMessageToDocx(content: string, filename = "advisor-response.docx"): Promise<void> {
  const children = markdownToDocxChildren(content);

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: "\u25E6",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ properties: {}, children }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
