import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
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
  headerCell,
  dataCell,
  sectionHeading,
  titleBlock,
  codeBlock,
  codeLabel,
  bulletParagraph,
  NUMBERING_CONFIG,
  DEFAULT_STYLES,
  PAGE_SECTION_PROPERTIES,
} from "./docxHelpers";
import type { BicepResult, CostEstimate, AdrRecord, WafPillarResult } from "../types";

function costTable(estimate: CostEstimate): Table {
  const cols = [3200, 1600, 1400, 800, 1400, 960];
  const headers = ["Service", "SKU", "Region", "Qty", "$/mo", "Notes"];
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => headerCell(h, cols[i])) }),
      ...estimate.line_items.map((item) =>
        new TableRow({
          children: [
            dataCell(item.service, cols[0]),
            dataCell(item.sku ?? "—", cols[1]),
            dataCell(item.region ?? "—", cols[2]),
            dataCell(String(item.quantity ?? 1), cols[3]),
            dataCell(item.monthly_estimate != null ? `$${item.monthly_estimate.toLocaleString()}` : "—", cols[4]),
            dataCell("", cols[5]),
          ],
        })
      ),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Total", bold: true })] })], width: { size: cols[0], type: WidthType.DXA }, borders: cellBorder(), shading: { type: ShadingType.CLEAR, fill: "E8F4F8" }, margins: { top: 80, bottom: 80, left: 120, right: 120 } }),
          new TableCell({ children: [new Paragraph({ text: "" })], width: { size: cols[1], type: WidthType.DXA }, borders: cellBorder(), margins: { top: 80, bottom: 80, left: 120, right: 120 } }),
          new TableCell({ children: [new Paragraph({ text: "" })], width: { size: cols[2], type: WidthType.DXA }, borders: cellBorder(), margins: { top: 80, bottom: 80, left: 120, right: 120 } }),
          new TableCell({ children: [new Paragraph({ text: "" })], width: { size: cols[3], type: WidthType.DXA }, borders: cellBorder(), margins: { top: 80, bottom: 80, left: 120, right: 120 } }),
          dataCell(`$${estimate.total_monthly_estimate.toLocaleString()}`, cols[4], "E8F4F8"),
          new TableCell({ children: [new Paragraph({ text: "" })], width: { size: cols[5], type: WidthType.DXA }, borders: cellBorder(), margins: { top: 80, bottom: 80, left: 120, right: 120 } }),
        ],
      }),
    ],
  });
}

export interface ArchitectureExportOptions {
  explanation: string;
  runbook?: string | null;
  bicepResult?: BicepResult | null;
  costEstimate?: CostEstimate | null;
  adrRecord?: AdrRecord | null;
  wafResults?: Record<string, WafPillarResult>;
  hasDiagram?: boolean;
  filename?: string;
}

export async function exportArchitectureToDocx(options: ArchitectureExportOptions): Promise<void> {
  const filename = options.filename ?? "architecture-design.docx";

  const PILLAR_LABELS: Record<string, string> = {
    reliability: "Reliability", security: "Security", cost: "Cost Optimization",
    "operational-excellence": "Operational Excellence", performance: "Performance Efficiency",
  };

  const children: (Paragraph | Table)[] = [
    ...titleBlock("Azure Architecture Design"),
    ...markdownToDocxChildren(options.explanation),
  ];

  if (options.hasDiagram) {
    children.push(
      sectionHeading("Architecture Diagram"),
      new Paragraph({
        children: [new TextRun({ text: "Architecture diagram is available as a .drawio file. Download it from the Architecture Design panel and open in draw.io or diagrams.net.", italics: true, color: "444444" })],
        spacing: { after: 160 },
      }),
    );
  }

  if (options.runbook) {
    children.push(sectionHeading("Runbook"), ...markdownToDocxChildren(options.runbook));
  }

  if (options.bicepResult) {
    children.push(
      sectionHeading("Infrastructure as Code (Bicep)"),
      codeLabel("main.bicep"),
      codeBlock(options.bicepResult.bicep_code),
    );
    if (options.bicepResult.param_file) {
      children.push(codeLabel("main.bicepparam"), codeBlock(options.bicepResult.param_file));
    }
    if (options.bicepResult.deploy_commands.length > 0) {
      children.push(codeLabel("Deploy Commands"), codeBlock(options.bicepResult.deploy_commands.join("\n")));
    }
    if (options.bicepResult.notes.length > 0) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Notes", bold: true, size: 22 })], spacing: { before: 160, after: 60 } }),
        ...options.bicepResult.notes.map(bulletParagraph),
      );
    }
  }

  if (options.costEstimate) {
    children.push(
      sectionHeading("Cost Estimate"),
      new Paragraph({
        children: [
          new TextRun({ text: "Estimated monthly total: ", bold: true }),
          new TextRun({ text: `$${options.costEstimate.total_monthly_estimate.toLocaleString()} ${options.costEstimate.currency}`, bold: true, color: "0078D4", size: 26 }),
        ],
        spacing: { after: 160 },
      }),
      costTable(options.costEstimate),
      new Paragraph({ text: "", spacing: { after: 120 } }),
    );
    if (options.costEstimate.optimization_tips && options.costEstimate.optimization_tips.length > 0) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Optimization Tips", bold: true, size: 22 })], spacing: { before: 120, after: 60 } }),
        ...options.costEstimate.optimization_tips.map(bulletParagraph),
      );
    }
    if (options.costEstimate.disclaimer) {
      children.push(new Paragraph({ children: [new TextRun({ text: options.costEstimate.disclaimer, italics: true, color: "888888", size: 18 })], spacing: { before: 80, after: 80 } }));
    }
  }

  if (options.adrRecord) {
    const adr = options.adrRecord;
    children.push(
      sectionHeading("Architecture Decision Record"),
      new Paragraph({ children: [new TextRun({ text: adr.title, bold: true, size: 28 })], spacing: { before: 120, after: 80 } }),
      new Paragraph({ children: [new TextRun({ text: "Context", bold: true, size: 22, underline: { type: UnderlineType.SINGLE } })], spacing: { before: 120, after: 60 } }),
      new Paragraph({ children: parseInline(adr.context), spacing: { after: 120 } }),
      new Paragraph({ children: [new TextRun({ text: "Decision", bold: true, size: 22, underline: { type: UnderlineType.SINGLE } })], spacing: { before: 120, after: 60 } }),
      new Paragraph({ children: parseInline(adr.decision), spacing: { after: 120 } }),
      new Paragraph({ children: [new TextRun({ text: "Consequences", bold: true, size: 22, underline: { type: UnderlineType.SINGLE } })], spacing: { before: 120, after: 60 } }),
      new Paragraph({ children: parseInline(adr.consequences), spacing: { after: 120 } }),
    );
    if (adr.alternatives && adr.alternatives.length > 0) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Alternatives Considered", bold: true, size: 22, underline: { type: UnderlineType.SINGLE } })], spacing: { before: 120, after: 60 } }),
        ...adr.alternatives.map(bulletParagraph),
      );
    }
  }

  if (options.wafResults && Object.keys(options.wafResults).length > 0) {
    children.push(sectionHeading("WAF Assessment"));
    for (const pillar of Object.values(options.wafResults)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${PILLAR_LABELS[pillar.pillar] ?? pillar.pillar} — ${pillar.score}/5`, bold: true, size: 24 })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 80 },
        }),
      );
      if (pillar.findings.length > 0) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: "Findings", bold: true, size: 20 })], spacing: { before: 80, after: 40 } }),
          ...pillar.findings.map(bulletParagraph),
        );
      }
      if (pillar.recommendations.length > 0) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: "Recommendations", bold: true, size: 20 })], spacing: { before: 80, after: 40 } }),
          ...pillar.recommendations.map((r) => bulletParagraph(typeof r === "string" ? r : (r.learn_url ? `${r.text} (${r.learn_url})` : r.text))),
        );
      }
    }
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
