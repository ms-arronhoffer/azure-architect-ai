import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Render a subset of Markdown (headings, paragraphs, lists, tables, code
// blocks, blockquotes, horizontal rules) into a paginated PDF. Inline emphasis
// markers (**bold**, *italic*, `code`) are stripped to plain text since jsPDF
// has no rich-text run support within a single line.

const MARGIN = 48; // pt
const LINE_GAP = 4;

function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
}

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((_, i, a) => i > 0 && i < a.length - 1)
    .map(stripInline);
}

export function markdownToPdf(markdown: string): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY: number } };
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const writeBlock = (
    text: string,
    opts: { size: number; style?: "normal" | "bold" | "italic"; font?: string; indent?: number; color?: number } = { size: 11 }
  ) => {
    const indent = opts.indent ?? 0;
    doc.setFont(opts.font ?? "helvetica", opts.style ?? "normal");
    doc.setFontSize(opts.size);
    doc.setTextColor(opts.color ?? 0);
    const lineHeight = opts.size + LINE_GAP;
    const wrapped = doc.splitTextToSize(text, contentWidth - indent) as string[];
    for (const w of wrapped) {
      ensureSpace(lineHeight);
      doc.text(w, MARGIN + indent, y);
      y += lineHeight;
    }
    doc.setTextColor(0);
  };

  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      for (const cl of code) {
        writeBlock(cl || " ", { size: 9, font: "courier", color: 60 });
      }
      y += LINE_GAP;
      continue;
    }

    // Table
    if (line.startsWith("|")) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const head = parseTableRow(tableLines[0]);
        const body = tableLines.slice(2).map(parseTableRow);
        ensureSpace(40);
        autoTable(doc, {
          head: [head],
          body,
          startY: y,
          margin: { left: MARGIN, right: MARGIN },
          styles: { fontSize: 9, cellPadding: 4 },
          headStyles: { fillColor: [213, 232, 240], textColor: 20 },
        });
        y = ((doc as AutoTableDoc).lastAutoTable?.finalY ?? y) + 10;
      }
      continue;
    }

    // Headings
    const hm = /^(#{1,5}) (.+)/.exec(line);
    if (hm) {
      const level = hm[1].length;
      const size = [20, 16, 14, 12, 11][level - 1] ?? 11;
      y += LINE_GAP;
      writeBlock(stripInline(hm[2]), { size, style: "bold" });
      y += LINE_GAP / 2;
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*]{3,}$/.test(line.trim())) {
      ensureSpace(12);
      doc.setDrawColor(200);
      doc.line(MARGIN, y, pageWidth - MARGIN, y);
      y += 10;
      i++;
      continue;
    }

    // Blockquote
    const bq = /^> (.*)/.exec(line);
    if (bq) {
      writeBlock(stripInline(bq[1]), { size: 11, style: "italic", indent: 18, color: 90 });
      i++;
      continue;
    }

    // Ordered list
    const olm = /^(\s*)(\d+)\. (.+)/.exec(line);
    if (olm) {
      const indent = olm[1].length >= 2 ? 36 : 18;
      writeBlock(`${olm[2]}. ${stripInline(olm[3])}`, { size: 11, indent });
      i++;
      continue;
    }

    // Unordered list
    const ulm = /^(\s*)[-*] (.+)/.exec(line);
    if (ulm) {
      const indent = ulm[1].length >= 2 ? 36 : 18;
      writeBlock(`\u2022 ${stripInline(ulm[2])}`, { size: 11, indent });
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      y += LINE_GAP + 2;
      i++;
      continue;
    }

    // Normal paragraph
    writeBlock(stripInline(line), { size: 11 });
    i++;
  }

  return doc;
}

export function exportMarkdownToPdf(markdown: string, filename = "report.pdf"): void {
  const doc = markdownToPdf(markdown);
  doc.save(filename);
}
