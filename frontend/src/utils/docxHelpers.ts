import {
  Paragraph,
  TextRun,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  AlignmentType,
  LevelFormat,
  UnderlineType,
} from "docx";
import { parseInline } from "./docxExport";

export const TABLE_WIDTH = 9360;

export function cellBorder() {
  const b = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
  return { top: b, bottom: b, left: b, right: b };
}

export function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 20 })], alignment: AlignmentType.CENTER })],
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: "0078D4" },
    borders: cellBorder(),
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });
}

export function dataCell(text: string, width: number, fill?: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: parseInline(text) })],
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    borders: cellBorder(),
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });
}

export function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: title, bold: true, size: 36, color: "0078D4" })],
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "0078D4", space: 4 } },
  });
}

export function titleBlock(title: string): Paragraph[] {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return [
    new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 56, color: "0078D4" })], spacing: { after: 80 } }),
    new Paragraph({ children: [new TextRun({ text: `Generated: ${today}`, size: 20, color: "666666" })], spacing: { after: 40 } }),
    new Paragraph({
      children: [new TextRun({ text: "Confidential — For internal use and customer review", italics: true, size: 18, color: "888888" })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "0078D4", space: 4 } },
      spacing: { after: 360 },
    }),
  ];
}

export function codeBlock(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: "Courier New", size: 18 })],
    spacing: { after: 120 },
    shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
  });
}

export function codeLabel(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24, underline: { type: UnderlineType.SINGLE } })],
    spacing: { before: 120, after: 80 },
  });
}

export function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    children: parseInline(text),
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 40 },
  });
}

export const NUMBERING_CONFIG = {
  config: [
    {
      reference: "bullets",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ],
    },
  ],
};

export const PARAGRAPH_STYLES = [
  { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 36, bold: true, font: "Calibri", color: "2E4057" }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 } },
  { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, font: "Calibri", color: "2E4057" }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 1 } },
  { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, font: "Calibri", color: "404040" }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 2 } },
  { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true, italics: true, font: "Calibri", color: "555555" }, paragraph: { spacing: { before: 120, after: 40 }, outlineLevel: 3 } },
  { id: "Heading5", name: "Heading 5", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true, font: "Calibri", color: "666666" }, paragraph: { spacing: { before: 100, after: 40 }, outlineLevel: 4 } },
];

export const DEFAULT_STYLES = {
  default: { document: { run: { font: "Calibri", size: 22 } } },
  paragraphStyles: PARAGRAPH_STYLES,
};

export const PAGE_SECTION_PROPERTIES = {
  page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
};
