import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
} from "docx";
import type { LearningPlan, LearningModule } from "../types";

const CONTENT_WIDTH = 9360; // US Letter, 1" margins

const AZURE_BLUE = "0078D4";
const AMBER = "92400E";
const GREEN = "065F46";
const LIGHT_BLUE = "DBEAFE";
const LIGHT_AMBER = "FEF3C7";
const LIGHT_GREEN = "D1FAE5";
const NEUTRAL_BG = "F3F4F6";
const BORDER_COLOR = "D1D5DB";

function border(color = BORDER_COLOR) {
  const s = { style: BorderStyle.SINGLE, size: 1, color };
  return { top: s, bottom: s, left: s, right: s };
}

function heading1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, color: AZURE_BLUE, bold: true, size: 36, font: "Calibri" })],
    spacing: { after: 160 },
  });
}

function heading2(text: string, color = "1F2937"): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, color, bold: true, size: 26, font: "Calibri" })],
    spacing: { before: 280, after: 100 },
  });
}

function heading3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, color: "374151", bold: true, size: 22, font: "Calibri" })],
    spacing: { before: 200, after: 80 },
  });
}

function body(text: string, italic = false): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, font: "Calibri", italics: italic, color: "4B5563" })],
    spacing: { after: 80 },
  });
}

function bullet(text: string, ref: string): Paragraph {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    children: [new TextRun({ text, size: 22, font: "Calibri", color: "374151" })],
    spacing: { after: 40 },
  });
}

function metaCell(label: string, value: string, bg: string): TableCell {
  return new TableCell({
    borders: border(),
    width: { size: CONTENT_WIDTH / 3, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: label.toUpperCase(), size: 16, bold: true, color: "6B7280", font: "Calibri" })],
        spacing: { after: 40 },
      }),
      new Paragraph({
        children: [new TextRun({ text: value, size: 22, bold: true, color: "111827", font: "Calibri" })],
      }),
    ],
  });
}

function infoTable(items: string[], bg: string): Table {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: border(),
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { fill: bg, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 160, right: 160 },
            children: items.map(item =>
              new Paragraph({
                children: [new TextRun({ text: `• ${item}`, size: 22, font: "Calibri", color: "374151" })],
                spacing: { after: 40 },
              })
            ),
          }),
        ],
      }),
    ],
  });
}

function moduleSection(mod: LearningModule, bulletRef: string): Paragraph[] {
  const paras: Paragraph[] = [heading3(`${mod.session_label} — ${mod.title}`)];

  if (mod.duration_hours) {
    paras.push(body(`Duration: ${mod.duration_hours} hours`, true));
  }
  paras.push(body(mod.description));

  if (mod.topics.length > 0) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: "TOPICS COVERED", size: 18, bold: true, color: "6B7280", font: "Calibri" })],
      spacing: { before: 120, after: 40 },
    }));
    mod.topics.forEach(t => paras.push(bullet(t, bulletRef)));
  }

  if (mod.skills_taught.length > 0) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: "SKILLS TAUGHT", size: 18, bold: true, color: "065F46", font: "Calibri" })],
      spacing: { before: 120, after: 40 },
    }));
    mod.skills_taught.forEach(s => paras.push(bullet(s, bulletRef)));
  }

  if (mod.activities && mod.activities.length > 0) {
    paras.push(new Paragraph({
      children: [new TextRun({ text: "HANDS-ON ACTIVITIES", size: 18, bold: true, color: "1E40AF", font: "Calibri" })],
      spacing: { before: 120, after: 40 },
    }));
    mod.activities.forEach(a => paras.push(bullet(a, bulletRef)));
  }

  return paras;
}

function groupByDay(modules: LearningModule[]): Map<string, LearningModule[]> {
  const groups = new Map<string, LearningModule[]>();
  for (const m of modules) {
    const day = m.session_label.split("–")[0].trim();
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(m);
  }
  return groups;
}

export async function downloadLearningPlan(plan: LearningPlan): Promise<void> {
  const durationLabel = plan.duration_days === 0.5
    ? "Half Day (3.5 hrs)"
    : `${plan.duration_days} Day${plan.duration_days !== 1 ? "s" : ""}`;

  const children: (Paragraph | Table)[] = [];

  // Title
  children.push(heading1(plan.title));
  children.push(body(plan.overview));

  // Meta table
  children.push(
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [CONTENT_WIDTH / 3, CONTENT_WIDTH / 3, CONTENT_WIDTH / 3],
      rows: [
        new TableRow({
          children: [
            metaCell("Audience", plan.target_audience || "All levels", LIGHT_BLUE),
            metaCell("Duration", durationLabel, NEUTRAL_BG),
            metaCell("Sessions", `${plan.modules.length} sessions`, NEUTRAL_BG),
          ],
        }),
      ],
    })
  );

  children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));

  // Prerequisites
  children.push(heading2("Prerequisite Skills", AMBER));
  if (plan.prerequisites.length === 0) {
    children.push(body("No prerequisites required."));
  } else {
    children.push(infoTable(plan.prerequisites, LIGHT_AMBER));
  }

  // Learning Outcomes
  children.push(heading2("Learning Outcomes", GREEN));
  if (plan.learning_outcomes.length > 0) {
    children.push(infoTable(plan.learning_outcomes, LIGHT_GREEN));
  }

  // Modules by day
  children.push(heading2("Learning Modules", "1F2937"));
  const groups = groupByDay(plan.modules);
  for (const [day, mods] of groups.entries()) {
    children.push(heading2(day, AZURE_BLUE));
    for (const mod of mods) {
      children.push(...moduleSection(mod, "bullets"));
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 560, hanging: 280 } } },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 36, bold: true, font: "Calibri" },
          paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 },
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, font: "Calibri" },
          paragraph: { spacing: { before: 280, after: 100 }, outlineLevel: 1 },
        },
        {
          id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 22, bold: true, font: "Calibri" },
          paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${plan.title.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_")}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
