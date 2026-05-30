import type { ServiceComparison } from "../types";

export function copyComparisonAsMarkdown(data: ServiceComparison): void {
  const header = `| Dimension | ${data.services.join(" | ")} |`;
  const separator = `| --- | ${data.services.map(() => "---").join(" | ")} |`;
  const rows = data.comparison_rows.map((row) => {
    const cells = data.services.map((s) => (resolveValue(row.values, s)).replace(/\|/g, "\\|"));
    return `| ${row.dimension} | ${cells.join(" | ")} |`;
  });
  const recommendation = `\n**Recommendation:** ${data.recommendation}`;
  const md = [header, separator, ...rows, recommendation].join("\n");
  navigator.clipboard.writeText(md);
}

export function exportComparisonSvg(data: ServiceComparison): void {
  const svg = buildSvgString(data);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  triggerDownload(URL.createObjectURL(blob), `${slugify(data.services.join("-"))}-comparison.svg`);
}

export async function exportComparisonPng(data: ServiceComparison): Promise<void> {
  const svg = buildSvgString(data);
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  canvas.toBlob((blob) => {
    if (!blob) return;
    triggerDownload(URL.createObjectURL(blob), `${slugify(data.services.join("-"))}-comparison.png`);
  }, "image/png");
}

function buildSvgString(data: ServiceComparison): string {
  const COL_W = 200;
  const DIM_W = 180;
  const ROW_H = 68;
  const HEAD_H = 44;
  const PAD = 16;
  const totalCols = data.services.length + 1;
  const totalWidth = DIM_W + COL_W * data.services.length + PAD * 2;
  const totalHeight = HEAD_H + ROW_H * data.comparison_rows.length + PAD * 2 + 60;

  const AZURE = "#0078D4";
  const BG0 = "#ffffff";
  const BG1 = "#f3f4f6";
  const BORDER = "#d1d5db";
  const TEXT_DARK = "#111827";
  const TEXT_MED = "#374151";
  const TEXT_LIGHT = "#6b7280";
  const HEADER_BG = "#eff6ff";

  const colWidths = [DIM_W, ...data.services.map(() => COL_W)];
  let x = PAD;
  const colXs: number[] = [];
  for (const w of colWidths) { colXs.push(x); x += w; }

  const lines: string[] = [];

  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" style="font-family:Segoe UI,Arial,sans-serif">`);
  lines.push(`<rect width="${totalWidth}" height="${totalHeight}" fill="${BG0}" rx="8"/>`);

  // Title row
  lines.push(`<rect x="${PAD}" y="${PAD}" width="${totalWidth - PAD * 2}" height="${HEAD_H}" fill="${HEADER_BG}" rx="4"/>`);
  data.services.forEach((s, i) => {
    const cx = colXs[i + 1] + COL_W / 2;
    lines.push(`<text x="${cx}" y="${PAD + HEAD_H / 2 + 5}" text-anchor="middle" font-size="13" font-weight="600" fill="${AZURE}">${escXml(s)}</text>`);
  });
  lines.push(`<text x="${colXs[0] + 12}" y="${PAD + HEAD_H / 2 + 5}" font-size="12" font-weight="600" fill="${TEXT_LIGHT}">DIMENSION</text>`);

  // Rows
  data.comparison_rows.forEach((row, ri) => {
    const y = PAD + HEAD_H + ri * ROW_H;
    const bg = ri % 2 === 0 ? BG0 : BG1;
    lines.push(`<rect x="${PAD}" y="${y}" width="${totalWidth - PAD * 2}" height="${ROW_H}" fill="${bg}"/>`);
    lines.push(`<text x="${colXs[0] + 12}" y="${y + ROW_H / 2 + 5}" font-size="12" font-weight="600" fill="${TEXT_MED}">${escXml(row.dimension)}</text>`);
    data.services.forEach((s, si) => {
      const val = resolveValue(row.values, s);
      const cx = colXs[si + 1] + COL_W / 2;
      const lines2 = wrapText(val, COL_W - 16);
      const lineH = 16;
      const startY = y + ROW_H / 2 - ((lines2.length - 1) * lineH) / 2 + 4;
      lines2.forEach((ln, li) => {
        lines.push(`<text x="${cx}" y="${startY + li * lineH}" text-anchor="middle" font-size="12" fill="${TEXT_DARK}">${escXml(ln)}</text>`);
      });
    });
    // horizontal divider
    lines.push(`<line x1="${PAD}" y1="${y + ROW_H}" x2="${totalWidth - PAD}" y2="${y + ROW_H}" stroke="${BORDER}" stroke-width="1"/>`);
  });

  // Vertical dividers
  for (let ci = 1; ci < totalCols; ci++) {
    lines.push(`<line x1="${colXs[ci]}" y1="${PAD}" x2="${colXs[ci]}" y2="${PAD + HEAD_H + data.comparison_rows.length * ROW_H}" stroke="${BORDER}" stroke-width="1"/>`);
  }

  // Outer border
  const tableH = HEAD_H + data.comparison_rows.length * ROW_H;
  lines.push(`<rect x="${PAD}" y="${PAD}" width="${totalWidth - PAD * 2}" height="${tableH}" fill="none" stroke="${BORDER}" stroke-width="1" rx="4"/>`);

  // Recommendation
  const recY = PAD + tableH + 20;
  lines.push(`<text x="${PAD}" y="${recY}" font-size="12" font-weight="600" fill="${AZURE}">Recommendation:</text>`);
  const recLines = wrapText(data.recommendation, totalWidth - PAD * 2 - 130);
  recLines.forEach((ln, li) => {
    lines.push(`<text x="${PAD + 128}" y="${recY + li * 18}" font-size="12" fill="${TEXT_DARK}">${escXml(ln)}</text>`);
  });

  lines.push(`</svg>`);
  return lines.join("\n");
}

function resolveValue(values: Record<string, string> | undefined, key: string): string {
  if (!values) return "—";
  if (key in values) return values[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(values)) {
    if (k.toLowerCase() === lower) return values[k];
  }
  for (const k of Object.keys(values)) {
    if (lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) return values[k];
  }
  const vals = Object.values(values);
  return vals.length === 1 ? vals[0] : "—";
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapText(text: string, maxWidth: number, charsPerPx = 0.13): string[] {
  const maxChars = Math.max(10, Math.floor(maxWidth * charsPerPx));
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3).map((l, i, a) => i === a.length - 1 && a.length === 3 && text.split(" ").length > 3 ? l + "…" : l);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
