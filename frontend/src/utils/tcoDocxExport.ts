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
import type { TcoReport } from "../types";

function onPremTable(items: TcoReport["on_prem_items"]): Table {
  const cols = [2800, 4440, 2120];
  const mkHeader = (text: string, width: number): TableCell =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.CENTER })],
      width: { size: width, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: "555555" },
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
  const annualTotal = items.reduce((s, i) => s + i.annual_cost, 0);

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: [
      new TableRow({ tableHeader: true, children: ["Category", "Description", "Annual Cost"].map((h, i) => mkHeader(h, cols[i])) }),
      ...items.map((item) =>
        new TableRow({
          children: [
            mkData(item.category, cols[0]),
            mkData(item.description, cols[1]),
            mkData(`$${item.annual_cost.toLocaleString()}`, cols[2]),
          ],
        })
      ),
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            children: [new Paragraph({ children: [new TextRun({ text: "TOTAL ANNUAL", bold: true, size: 18 })], alignment: AlignmentType.RIGHT })],
            borders: cellBorder(),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            shading: { type: ShadingType.CLEAR, fill: "F0F0F0" },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: `$${annualTotal.toLocaleString()}`, bold: true, size: 20 })] })],
            width: { size: cols[2], type: WidthType.DXA },
            borders: cellBorder(),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            shading: { type: ShadingType.CLEAR, fill: "F0F0F0" },
          }),
        ],
      }),
    ],
  });
}

function azureTable(items: TcoReport["azure_items"]): Table {
  const cols = [3600, 2760, 3000];
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
  const monthlyTotal = items.reduce((s, i) => s + i.monthly_cost, 0);

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: [
      new TableRow({ tableHeader: true, children: ["Azure Service", "SKU / Tier", "Monthly Cost"].map((h, i) => mkHeader(h, cols[i])) }),
      ...items.map((item) =>
        new TableRow({
          children: [
            mkData(item.service, cols[0]),
            mkData(item.sku, cols[1]),
            mkData(`$${item.monthly_cost.toLocaleString()}`, cols[2]),
          ],
        })
      ),
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            children: [new Paragraph({ children: [new TextRun({ text: "TOTAL MONTHLY", bold: true, size: 18 })], alignment: AlignmentType.RIGHT })],
            borders: cellBorder(),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            shading: { type: ShadingType.CLEAR, fill: "EEF4FF" },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: `$${monthlyTotal.toLocaleString()}`, bold: true, size: 20 })] })],
            width: { size: cols[2], type: WidthType.DXA },
            borders: cellBorder(),
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            shading: { type: ShadingType.CLEAR, fill: "EEF4FF" },
          }),
        ],
      }),
    ],
  });
}

export interface TcoExportOptions {
  migrationPlan?: string;
  filename?: string;
}

export async function exportTCOToDocx(
  narrative: string,
  tcoReport: TcoReport | null,
  options: TcoExportOptions = {}
): Promise<void> {
  const filename = options.filename ?? "tco-analysis.docx";

  const children: (Paragraph | Table)[] = [
    ...titleBlock("Azure Total Cost of Ownership Analysis"),
  ];

  if (narrative) {
    children.push(sectionHeading("Executive Summary"), ...markdownToDocxChildren(narrative));
  }

  if (tcoReport) {
    if (tcoReport.on_prem_items.length > 0) {
      children.push(
        sectionHeading("Current On-Premises Costs"),
        onPremTable(tcoReport.on_prem_items),
        new Paragraph({ text: "", spacing: { after: 120 } }),
      );
    }

    if (tcoReport.azure_items.length > 0) {
      children.push(
        sectionHeading("Projected Azure Cloud Costs"),
        azureTable(tcoReport.azure_items),
        new Paragraph({ text: "", spacing: { after: 120 } }),
      );
    }

    children.push(sectionHeading("3-Year Financial Projection"));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "On-Premises 3-Year Total: ", bold: true }), new TextRun({ text: `$${tcoReport.three_year_on_prem_total.toLocaleString()}` })],
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: "Azure Cloud 3-Year Total: ", bold: true }), new TextRun({ text: `$${tcoReport.three_year_azure_total.toLocaleString()}`, color: "0078D4" })],
        spacing: { after: 60 },
      }),
    );
    if (tcoReport.savings_percentage != null) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "3-Year Savings: ", bold: true }), new TextRun({ text: `${tcoReport.savings_percentage.toFixed(1)}%`, bold: true, color: "107C10" })],
        spacing: { after: 60 },
      }));
    }
    if (tcoReport.break_even_months != null) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Break-even: ", bold: true }), new TextRun({ text: `Month ${tcoReport.break_even_months}` })],
        spacing: { after: 60 },
      }));
    }
    if (tcoReport.migration_cost_estimate != null) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Migration Cost Estimate: ", bold: true }), new TextRun({ text: `$${tcoReport.migration_cost_estimate.toLocaleString()}` })],
        spacing: { after: 160 },
      }));
    }

    if (tcoReport.recommendations.length > 0) {
      children.push(
        sectionHeading("Recommendations"),
        ...tcoReport.recommendations.map(bulletParagraph),
      );
    }
  }

  if (options.migrationPlan) {
    children.push(sectionHeading("Migration Cost Analysis"), ...markdownToDocxChildren(options.migrationPlan));
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
