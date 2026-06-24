import * as XLSX from "xlsx";
import type { PricedWorksheet } from "../types";

// Excel export for the Pricing Desk worksheet. Produces two sheets:
//   1. "Pricing Worksheet" — one row per service line plus its meter breakdown.
//   2. "Recommendations"   — optimization tips + any reservation adjustments.
// Mirrors the xlsx export pattern used in ModelLifecyclePanel.tsx.

const LINE_COLUMNS = [
  "Service",
  "SKU",
  "Region",
  "Meter",
  "Unit of measure",
  "Billable qty",
  "Unit price",
  "Monthly cost",
] as const;

function fmtMoney(v: number | null | undefined, currency: string): string {
  if (v === null || v === undefined) return "—";
  return `${currency} ${v.toFixed(2)}`;
}

export function exportWorksheetToXlsx(worksheet: PricedWorksheet, filenameStem = "azure-pricing-desk") {
  const generated = new Date().toISOString().slice(0, 10);
  const currency = worksheet.currency || "USD";

  const rows: (string | number)[][] = [
    ["Azure Pricing Desk Worksheet"],
    [`Generated: ${generated}  ·  Source: ${worksheet.data_source || "Azure Retail Pricing API"}`],
    [],
    [...LINE_COLUMNS],
  ];

  for (const line of worksheet.line_items) {
    const label = line.display_name || line.service;
    const meters = line.meters?.length ? line.meters : [];
    if (meters.length === 0) {
      rows.push([label, line.sku || "", line.region || "", "—", "—", "", "", line.monthly_subtotal ?? ""]);
    }
    meters.forEach((m, idx) => {
      rows.push([
        idx === 0 ? label : "",
        idx === 0 ? line.sku || "" : "",
        idx === 0 ? line.region || "" : "",
        m.label || m.meter_name || m.dimension || "",
        m.unit_of_measure || m.unit || "",
        m.billable_quantity ?? m.quantity ?? "",
        m.unit_price ?? "",
        m.monthly_cost ?? "",
      ]);
    });
    // Per-line subtotal row.
    rows.push(["", "", "", "", "", "", "Line subtotal", line.monthly_subtotal ?? ""]);
  }

  rows.push([]);
  rows.push(["", "", "", "", "", "", "Total monthly estimate", worksheet.total_monthly_estimate ?? ""]);
  if (worksheet.reservation_monthly_savings) {
    rows.push(["", "", "", "", "", "", "Reservation savings", worksheet.reservation_monthly_savings]);
  }
  if (worksheet.disclaimer) {
    rows.push([]);
    rows.push([worksheet.disclaimer]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [26, 18, 14, 28, 18, 14, 14, 16].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pricing Worksheet");

  // Recommendations sheet.
  const recRows: (string | number)[][] = [["Cost-savings recommendations"], []];
  (worksheet.optimization_tips || []).forEach((tip, i) => recRows.push([`${i + 1}.`, tip]));
  if (worksheet.reservation_adjustments?.length) {
    recRows.push([]);
    recRows.push(["Reservation adjustments applied"]);
    recRows.push(["Service", "SKU", "Commitment", "Covered qty", "Monthly savings"]);
    for (const a of worksheet.reservation_adjustments) {
      recRows.push([a.service, a.sku, a.commit_key, a.covered_quantity, fmtMoney(a.monthly_savings, currency)]);
    }
  }
  if (recRows.length > 2) {
    const recWs = XLSX.utils.aoa_to_sheet(recRows);
    recWs["!cols"] = [22, 16, 18, 12, 16].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, recWs, "Recommendations");
  }

  XLSX.writeFile(wb, `${filenameStem}-${generated}.xlsx`);
}
