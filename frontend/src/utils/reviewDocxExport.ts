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
  ShadingType,
  UnderlineType,
} from "docx";
import { markdownToDocxChildren, parseInline } from "./docxExport";
import {
  TABLE_WIDTH,
  cellBorder,
  sectionHeading,
  titleBlock,
  bulletParagraph,
  NUMBERING_CONFIG,
  DEFAULT_STYLES,
  PAGE_SECTION_PROPERTIES,
} from "./docxHelpers";
import type { WafPillarResult } from "../types";

const PILLAR_LABELS: Record<string, string> = {
  reliability: "Reliability",
  security: "Security",
  cost: "Cost Optimization",
  "operational-excellence": "Operational Excellence",
  performance: "Performance Efficiency",
};

const SCORE_FILL: Record<number, string> = {
  1: "FFB3B3", 2: "FFD1B3", 3: "FFF3B0", 4: "C8F0C8", 5: "9EE89E",
};

const SCORE_LABEL: Record<number, string> = {
  1: "Critical", 2: "Poor", 3: "Fair", 4: "Good", 5: "Excellent",
};

function wafSummaryTable(pillars: WafPillarResult[]): Table {
  const colWidths = [2800, 1000, 1400, 1280, 2880];

  const headerCell = (text: string, width: number): TableCell =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.CENTER })],
      width: { size: width, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: "0078D4" },
      borders: cellBorder(),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });

  const dataCell = (children: TextRun[], width: number, fill?: string): TableCell =>
    new TableCell({
      children: [new Paragraph({ children, alignment: AlignmentType.CENTER })],
      width: { size: width, type: WidthType.DXA },
      shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
      borders: cellBorder(),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });

  const headers = ["WAF Pillar", "Score", "Status", "Findings", "Recommendations"];

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, idx) => headerCell(h, colWidths[idx])) }),
      ...pillars.map((p) => {
        const fill = SCORE_FILL[p.score] ?? "EEEEEE";
        return new TableRow({
          children: [
            dataCell([new TextRun({ text: PILLAR_LABELS[p.pillar] ?? p.pillar, size: 18 })], colWidths[0]),
            dataCell([new TextRun({ text: `${p.score}/5`, bold: true, size: 20 })], colWidths[1], fill),
            dataCell([new TextRun({ text: SCORE_LABEL[p.score] ?? "", size: 18 })], colWidths[2], fill),
            dataCell([new TextRun({ text: String(p.findings.length), size: 18 })], colWidths[3]),
            dataCell([new TextRun({ text: String(p.recommendations.length), size: 18 })], colWidths[4]),
          ],
        });
      }),
    ],
  });
}

function pillarSection(p: WafPillarResult): (Paragraph | Table)[] {
  const parts: (Paragraph | Table)[] = [];

  parts.push(new Paragraph({
    children: parseInline(PILLAR_LABELS[p.pillar] ?? p.pillar),
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 80 },
  }));

  parts.push(new Paragraph({
    children: [
      new TextRun({ text: "Score: ", bold: true }),
      new TextRun({ text: `${p.score}/5 — ${SCORE_LABEL[p.score] ?? ""}` }),
    ],
    spacing: { after: 120 },
  }));

  if (p.findings.length > 0) {
    parts.push(new Paragraph({
      children: [new TextRun({ text: "Findings", bold: true, size: 22, underline: { type: UnderlineType.SINGLE } })],
      spacing: { before: 120, after: 60 },
    }));
    for (const f of p.findings) parts.push(bulletParagraph(f));
  }

  if (p.recommendations.length > 0) {
    parts.push(new Paragraph({
      children: [new TextRun({ text: "Recommendations", bold: true, size: 22, underline: { type: UnderlineType.SINGLE } })],
      spacing: { before: 160, after: 60 },
    }));
    for (const r of p.recommendations) parts.push(bulletParagraph(r));
  }

  return parts;
}

export interface ReviewExportOptions {
  migrationPlan?: string;
  referenceDesign?: string;
  requirements?: string;
  hasDiagrams?: boolean;
  filename?: string;
}

export async function exportReviewToDocx(
  narrative: string,
  pillars: WafPillarResult[],
  options: ReviewExportOptions | string = {}
): Promise<void> {
  const opts: ReviewExportOptions = typeof options === "string" ? { filename: options } : options;
  const filename = opts.filename ?? "architecture-review.docx";

  const narrativeBlock = markdownToDocxChildren(narrative);

  const wafBlock: (Paragraph | Table)[] = [];
  if (pillars.length > 0) {
    wafBlock.push(
      sectionHeading("WAF Pillar Assessment Summary"),
      wafSummaryTable(pillars),
      new Paragraph({ text: "", spacing: { after: 200 } }),
      sectionHeading("Detailed Findings & Recommendations"),
    );
    for (const p of pillars) wafBlock.push(...pillarSection(p));
  }

  const deliverableBlocks: (Paragraph | Table)[] = [];

  function deliverableSection(title: string, content: string): void {
    deliverableBlocks.push(sectionHeading(title), ...markdownToDocxChildren(content));
  }

  if (opts.hasDiagrams) {
    deliverableBlocks.push(
      sectionHeading("Architecture Diagrams"),
      new Paragraph({
        children: [new TextRun({ text: "Architecture diagrams are available as .drawio files. Download them from the Architecture Review panel and open in draw.io or diagrams.net.", italics: true, color: "444444" })],
        spacing: { after: 160 },
      }),
    );
  }
  if (opts.migrationPlan) deliverableSection("Migration Plan", opts.migrationPlan);
  if (opts.referenceDesign) deliverableSection("Reference Design", opts.referenceDesign);
  if (opts.requirements) deliverableSection("Requirements", opts.requirements);

  const doc = new Document({
    numbering: NUMBERING_CONFIG,
    styles: DEFAULT_STYLES,
    sections: [{
      properties: PAGE_SECTION_PROPERTIES,
      children: [...titleBlock("Azure Architecture Review"), ...narrativeBlock, ...wafBlock, ...deliverableBlocks],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
