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
import type { SkuRecommendation, CostEstimate } from "../types";

function skuTable(skuRec: SkuRecommendation): Table {
  const cols = [2000, 1600, 700, 900, 1400, 3160];
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
      new TableRow({
        tableHeader: true,
        children: ["Component", "Recommended SKU", "vCPU", "RAM (GB)", "Utilization Target", "Reasoning"].map((h, i) =>
          mkHeader(h, cols[i])
        ),
      }),
      ...skuRec.recommendations.map((rec) =>
        new TableRow({
          children: [
            mkData(rec.component, cols[0]),
            mkData(rec.recommended_sku, cols[1]),
            mkData(rec.vcpu != null ? String(rec.vcpu) : "—", cols[2]),
            mkData(rec.memory_gb != null ? String(rec.memory_gb) : "—", cols[3]),
            mkData(rec.utilization_target ?? "—", cols[4]),
            mkData(rec.reasoning, cols[5]),
          ],
        })
      ),
    ],
  });
}

function costTable(costEst: CostEstimate): Table {
  const cols = [2800, 1600, 1600, 3360];
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
  const totalRow = new TableRow({
    children: [
      new TableCell({
        columnSpan: 3,
        children: [new Paragraph({ children: [new TextRun({ text: "TOTAL MONTHLY", bold: true, size: 18 })], alignment: AlignmentType.RIGHT })],
        borders: cellBorder(),
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        shading: { type: ShadingType.CLEAR, fill: "EEF4FF" },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: `$${costEst.total_monthly_estimate.toLocaleString()}`, bold: true, size: 20 })] })],
        width: { size: cols[3], type: WidthType.DXA },
        borders: cellBorder(),
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        shading: { type: ShadingType.CLEAR, fill: "EEF4FF" },
      }),
    ],
  });

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: [
      new TableRow({ tableHeader: true, children: ["Service", "SKU", "Quantity", "Monthly Estimate"].map((h, i) => mkHeader(h, cols[i])) }),
      ...costEst.line_items.map((item) =>
        new TableRow({
          children: [
            mkData(item.service, cols[0]),
            mkData(item.sku, cols[1]),
            mkData(`${item.quantity} ${item.unit_of_measure}`, cols[2]),
            mkData(item.monthly_estimate != null ? `$${item.monthly_estimate.toLocaleString()}` : "—", cols[3]),
          ],
        })
      ),
      totalRow,
    ],
  });
}

export interface SizingExportOptions {
  riSavings?: string;
  filename?: string;
}

export async function exportSizingToDocx(
  narrative: string,
  skuRec: SkuRecommendation | null,
  costEst: CostEstimate | null,
  options: SizingExportOptions = {}
): Promise<void> {
  const filename = options.filename ?? "sizing-assessment.docx";

  const children: (Paragraph | Table)[] = [
    ...titleBlock("Azure Capacity Sizing Report"),
  ];

  if (narrative) {
    children.push(sectionHeading("Sizing Assessment"), ...markdownToDocxChildren(narrative));
  }

  if (skuRec && skuRec.recommendations.length > 0) {
    children.push(
      sectionHeading("SKU Recommendations"),
      skuTable(skuRec),
      new Paragraph({ text: "", spacing: { after: 120 } }),
    );
    if (skuRec.sizing_assumptions?.length > 0) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Sizing Assumptions", bold: true, size: 22 })], spacing: { before: 160, after: 80 } }),
        ...skuRec.sizing_assumptions.map(bulletParagraph),
      );
    }
    if (skuRec.warnings?.length > 0) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Warnings", bold: true, size: 22, color: "CC4400" })], spacing: { before: 160, after: 80 } }),
        ...skuRec.warnings.map(bulletParagraph),
      );
    }
  }

  if (costEst) {
    children.push(
      sectionHeading("Cost Estimate"),
      costTable(costEst),
      new Paragraph({ text: "", spacing: { after: 120 } }),
    );
    if (costEst.optimization_tips?.length) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Optimization Tips", bold: true, size: 22 })], spacing: { before: 160, after: 80 } }),
        ...costEst.optimization_tips.map(bulletParagraph),
      );
    }
    if (costEst.disclaimer) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: costEst.disclaimer, italics: true, size: 16, color: "888888" })], spacing: { before: 80 } }),
      );
    }
  }

  if (options.riSavings) {
    children.push(sectionHeading("Reserved Instance Savings Analysis"), ...markdownToDocxChildren(options.riSavings));
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
