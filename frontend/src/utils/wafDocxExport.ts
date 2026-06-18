import { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType, UnderlineType } from "docx";
import { markdownToDocxChildren } from "./docxExport";
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

function summaryTable(pillars: WafPillarResult[]): Table {
  const cols = [2800, 1000, 1400, 1280, 2880];
  const mkHeader = (text: string, width: number): TableCell =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.CENTER })],
      width: { size: width, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: "0078D4" },
      borders: cellBorder(),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });
  const mkData = (children: TextRun[], width: number, fill?: string): TableCell =>
    new TableCell({
      children: [new Paragraph({ children, alignment: AlignmentType.CENTER })],
      width: { size: width, type: WidthType.DXA },
      shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
      borders: cellBorder(),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: [
      new TableRow({ tableHeader: true, children: ["WAF Pillar", "Score", "Status", "Findings", "Recommendations"].map((h, i) => mkHeader(h, cols[i])) }),
      ...pillars.map((p) => {
        const fill = SCORE_FILL[p.score] ?? "EEEEEE";
        return new TableRow({
          children: [
            mkData([new TextRun({ text: PILLAR_LABELS[p.pillar] ?? p.pillar, size: 18 })], cols[0]),
            mkData([new TextRun({ text: `${p.score}/5`, bold: true, size: 20 })], cols[1], fill),
            mkData([new TextRun({ text: SCORE_LABEL[p.score] ?? "", size: 18 })], cols[2], fill),
            mkData([new TextRun({ text: String(p.findings.length), size: 18 })], cols[3]),
            mkData([new TextRun({ text: String(p.recommendations.length), size: 18 })], cols[4]),
          ],
        });
      }),
    ],
  });
}

export interface WafExportOptions {
  remediationPlan?: string;
  filename?: string;
}

export async function exportWAFToDocx(pillars: WafPillarResult[], options: WafExportOptions = {}): Promise<void> {
  const filename = options.filename ?? "waf-assessment.docx";
  const avgScore = pillars.length > 0
    ? (pillars.reduce((s, p) => s + p.score, 0) / pillars.length).toFixed(1)
    : "0";

  const children: (Paragraph | Table)[] = [
    ...titleBlock("Azure WAF Assessment"),
    new Paragraph({
      children: [
        new TextRun({ text: "Overall Score: ", bold: true }),
        new TextRun({ text: `${avgScore}/5 across ${pillars.length} pillar${pillars.length !== 1 ? "s" : ""}`, bold: true, color: "0078D4", size: 26 }),
      ],
      spacing: { after: 160 },
    }),
    sectionHeading("Executive Summary"),
    summaryTable(pillars),
    new Paragraph({ text: "", spacing: { after: 200 } }),
    sectionHeading("Detailed Findings & Recommendations"),
  ];

  for (const p of pillars) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${PILLAR_LABELS[p.pillar] ?? p.pillar} — ${p.score}/5 (${SCORE_LABEL[p.score] ?? ""})`, bold: true, size: 28 })],
        spacing: { before: 280, after: 80 },
      }),
    );
    if (p.findings.length > 0) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Findings", bold: true, size: 22, underline: { type: UnderlineType.SINGLE } })], spacing: { before: 120, after: 60 } }),
        ...p.findings.map(bulletParagraph),
      );
    }
    if (p.recommendations.length > 0) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Recommendations", bold: true, size: 22, underline: { type: UnderlineType.SINGLE } })], spacing: { before: 160, after: 60 } }),
        ...p.recommendations.map((r) => bulletParagraph(typeof r === "string" ? r : (r.learn_url ? `${r.text} (${r.learn_url})` : r.text))),
      );
    }
  }

  if (options.remediationPlan) {
    children.push(sectionHeading("Remediation Roadmap"), ...markdownToDocxChildren(options.remediationPlan));
  }

  const doc = new Document({
    numbering: NUMBERING_CONFIG,
    styles: DEFAULT_STYLES,
    sections: [{ properties: PAGE_SECTION_PROPERTIES, children }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
