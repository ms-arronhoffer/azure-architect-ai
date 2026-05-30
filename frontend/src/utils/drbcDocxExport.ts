import { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType } from "docx";
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
import type { DrStrategy } from "../types";

const DR_PATTERN_LABELS: Record<string, string> = {
  "hot-standby": "Hot Standby",
  "warm-standby": "Warm Standby",
  "cold-standby": "Cold Standby",
  "pilot-light": "Pilot Light",
  "multi-region-active": "Multi-Region Active/Active",
};

function rtoRpoTable(strategy: DrStrategy): Table {
  const cols = [2400, 1600, 1600, 1500, 2260];
  const mkHeader = (text: string, width: number): TableCell =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.CENTER })],
      width: { size: width, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: "0078D4" },
      borders: cellBorder(),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });
  const mkData = (text: string, width: number): TableCell =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })],
      width: { size: width, type: WidthType.DXA },
      borders: cellBorder(),
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: [
      new TableRow({ tableHeader: true, children: ["Service", "DR Approach", "RPO Achieved", "Azure Feature", "Notes"].map((h, i) => mkHeader(h, cols[i])) }),
      ...strategy.service_configs.map((sc) =>
        new TableRow({
          children: [
            mkData(sc.service, cols[0]),
            mkData(sc.dr_approach, cols[1]),
            mkData(sc.rpo_achieved ?? "—", cols[2]),
            mkData(sc.azure_feature ?? "—", cols[3]),
            mkData("", cols[4]),
          ],
        })
      ),
    ],
  });
}

export interface DrbcExportOptions {
  narrative?: string;
  testPlan?: string;
  diagramAvailable?: boolean;
  filename?: string;
}

export async function exportDRBCToDocx(strategy: DrStrategy | null, options: DrbcExportOptions = {}): Promise<void> {
  const filename = options.filename ?? "dr-bc-strategy.docx";

  const children: (Paragraph | Table)[] = [
    ...titleBlock("Azure DR/BC Strategy"),
  ];

  if (strategy) {
    children.push(
      sectionHeading("DR Strategy Overview"),
      new Paragraph({
        children: [
          new TextRun({ text: "Pattern: ", bold: true }),
          new TextRun({ text: DR_PATTERN_LABELS[strategy.dr_pattern] ?? strategy.dr_pattern, bold: true, color: "0078D4", size: 24 }),
        ],
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Primary Region: ", bold: true }),
          new TextRun({ text: strategy.primary_region }),
          new TextRun({ text: "  →  Secondary Region: ", bold: true }),
          new TextRun({ text: strategy.secondary_region }),
        ],
        spacing: { after: 80 },
      }),
    );
    if (strategy.estimated_monthly_dr_cost) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `Estimated DR cost: ${strategy.estimated_monthly_dr_cost}/month`, italics: true, color: "444444" })],
        spacing: { after: 160 },
      }));
    }

    if (strategy.service_configs.length > 0) {
      children.push(sectionHeading("Service Configuration"), rtoRpoTable(strategy), new Paragraph({ text: "", spacing: { after: 120 } }));
    }

    if (strategy.failover_steps.length > 0) {
      children.push(
        sectionHeading("Failover Runbook"),
        ...strategy.failover_steps.map((step, i) =>
          new Paragraph({
            children: [new TextRun({ text: `${i + 1}. ${step}`, size: 22 })],
            spacing: { after: 60 },
          })
        ),
      );
    }

    if (strategy.test_plan.length > 0) {
      children.push(
        sectionHeading("DR Test Plan"),
        ...strategy.test_plan.map(bulletParagraph),
      );
    }
  }

  if (options.narrative) {
    children.push(sectionHeading("Design Narrative"), ...markdownToDocxChildren(options.narrative));
  }

  if (options.diagramAvailable) {
    children.push(
      sectionHeading("Architecture Diagram"),
      new Paragraph({
        children: [new TextRun({ text: "The DR architecture diagram is available as a .drawio file. Download it from the DR/BC Design panel and open in draw.io or diagrams.net.", italics: true, color: "444444" })],
        spacing: { after: 160 },
      }),
    );
  }

  if (options.testPlan) {
    children.push(sectionHeading("Detailed Test Plan"), ...markdownToDocxChildren(options.testPlan));
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
