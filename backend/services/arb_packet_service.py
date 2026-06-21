"""ARB reviewer-packet PDF generator.

Reuses Helvetica + Latin-1 sanitization from ``report_document_service`` so we
ship one PDF backend across the app. Output is a 9-section packet:

  1. Cover (engagement, design title, submitter, freeze timestamp)
  2. Architecture narrative
  3. Sizing narrative
  4. Cost line items + quota constraint flags
  5. Security findings
  6. WAF pillar summaries
  7. Frozen citations (corpus + URL + freshness at freeze time)
  8. Tenant inventory snapshot
  9. Reviewer worksheet (conditions checklist + signature block)

PDF generation is synchronous and CPU-bound. Routes call ``build_arb_packet``
inside a background task and stash the resulting bytes under
``backend/data/arb_packets/{submission_id}.pdf``; the submission row's
``reviewer_packet_url`` is filled in when the file lands.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from services.report_document_service import _sanitize_pdf

_AZURE_RGB = (0, 120, 212)
_DARK_RGB = (26, 32, 40)
_MUTED_RGB = (128, 152, 176)
_ACCENT_RGB = (80, 194, 255)
_CARD_RGB = (240, 244, 248)
_LIGHT_ROW_RGB = (255, 255, 255)

_SEVERITY_RGB: dict[str, tuple[int, int, int]] = {
    "blocker": (200, 50, 50),
    "major": (220, 100, 0),
    "minor": (180, 140, 0),
}

_STATUS_RGB: dict[str, tuple[int, int, int]] = {
    "open": (200, 50, 50),
    "in_progress": (220, 100, 0),
    "cleared": (0, 160, 80),
    "waived": (128, 152, 176),
}


def _fmt_ts(ms: int | None) -> str:
    if not ms:
        return "—"
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.UTC).strftime("%Y-%m-%d %H:%M UTC")


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)] + "…"


def build_arb_packet(
    *,
    submission: dict[str, Any],
    engagement: dict[str, Any] | None,
    conditions: list[dict[str, Any]],
    inventory: dict[str, Any] | None,
) -> bytes:
    """Render the ARB reviewer packet PDF.

    All inputs are plain dicts (the frozen snapshots), not ORM rows — this lets
    the function run from a background task without needing a live session.
    """
    from fpdf import FPDF  # type: ignore[import-untyped]

    bundled = submission.get("bundled_design_snapshot") or {}
    citations = submission.get("citation_snapshot") or []
    title = submission.get("title") or "Architecture Review Submission"
    submitted_by = submission.get("submitted_by") or "unknown"
    freeze_ts = _fmt_ts(submission.get("submitted_at"))
    eng_name = (engagement or {}).get("name") or "(unscoped engagement)"
    customer = (engagement or {}).get("customer_name") or ""

    class _PDF(FPDF):
        def header(self):
            if self.page_no() == 1:
                return
            self.set_fill_color(*_AZURE_RGB)
            self.rect(0, 0, 210, 4, "F")
            self.set_font("Helvetica", size=7)
            self.set_text_color(255, 255, 255)
            self.set_xy(10, 0)
            self.cell(
                190,
                4,
                _sanitize_pdf(f"ARB Packet - {eng_name} - {title}"),
                align="L",
            )
            self.set_text_color(0, 0, 0)
            self.ln(6)

        def footer(self):
            self.set_y(-11)
            self.set_font("Helvetica", size=7)
            self.set_text_color(*_MUTED_RGB)
            self.cell(
                0,
                5,
                _sanitize_pdf(
                    f"Frozen {freeze_ts}  -  Azure Architect AI  -  Page {self.page_no()}"
                ),
                align="C",
            )
            self.set_text_color(0, 0, 0)

    pdf = _PDF(orientation="P", unit="mm", format="A4")
    pdf.set_margins(15, 16, 15)
    pdf.set_auto_page_break(auto=True, margin=14)

    _render_cover(pdf, title, eng_name, customer, submitted_by, freeze_ts, submission)
    _render_section(pdf, "1. Architecture", (bundled.get("architecture") or {}).get("text", ""))
    _render_section(pdf, "2. Sizing", (bundled.get("sizing") or {}).get("text", ""))
    _render_cost_section(pdf, bundled)
    _render_section(pdf, "4. Security", (bundled.get("security") or {}).get("text", ""))
    _render_waf_section(pdf, bundled)
    _render_citations(pdf, citations)
    _render_inventory(pdf, inventory or {})
    _render_reviewer_worksheet(pdf, conditions)

    return bytes(pdf.output())


def _render_cover(
    pdf,
    title: str,
    eng_name: str,
    customer: str,
    submitted_by: str,
    freeze_ts: str,
    submission: dict[str, Any],
) -> None:
    pdf.add_page()
    pdf.set_fill_color(*_DARK_RGB)
    pdf.rect(15, 17, 180, 36, "F")
    pdf.set_fill_color(*_AZURE_RGB)
    pdf.rect(15, 17, 3, 36, "F")
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(22, 22)
    pdf.cell(170, 8, _sanitize_pdf("Architecture Review Board"))
    pdf.set_xy(22, 32)
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(170, 7, _sanitize_pdf(_truncate(title, 60)))
    pdf.set_xy(22, 41)
    pdf.set_font("Helvetica", size=9)
    pdf.set_text_color(*_ACCENT_RGB)
    pdf.cell(170, 5, _sanitize_pdf(f"Engagement: {eng_name}"))
    if customer:
        pdf.set_xy(22, 46)
        pdf.cell(170, 5, _sanitize_pdf(f"Customer: {customer}"))

    pdf.set_xy(15, 60)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, _sanitize_pdf("Submission metadata"), ln=1)
    pdf.set_font("Helvetica", size=9)
    rows = [
        ("Status", submission.get("status", "submitted")),
        ("Submitted by", submitted_by),
        ("Frozen at", freeze_ts),
        ("Submission ID", submission.get("id", "")),
        ("Decision", submission.get("decision_summary") or "—"),
        ("Decided by", submission.get("decided_by") or "—"),
        ("Decided at", _fmt_ts(submission.get("decided_at"))),
    ]
    for label, value in rows:
        pdf.set_x(15)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(40, 5, _sanitize_pdf(label))
        pdf.set_font("Helvetica", size=9)
        # Explicit width — fpdf2 2.8 multi_cell with w=0 mid-row computes
        # available width incorrectly when the cursor isn't at the left margin.
        pdf.multi_cell(140, 5, _sanitize_pdf(str(value)))

    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(*_MUTED_RGB)
    pdf.multi_cell(
        0,
        4,
        _sanitize_pdf(
            "This packet captures the design and citations as they stood at submission "
            "time. Subsequent edits to the underlying bundled design, RAG corpora, or "
            "tenant inventory do not mutate this artifact."
        ),
    )
    pdf.set_text_color(0, 0, 0)


def _render_section(pdf, heading: str, body: str) -> None:
    pdf.add_page()
    _section_heading(pdf, heading)
    body = (body or "").strip()
    if not body:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(*_MUTED_RGB)
        pdf.cell(0, 6, _sanitize_pdf("(empty)"), ln=1)
        pdf.set_text_color(0, 0, 0)
        return
    pdf.set_font("Helvetica", size=9)
    for paragraph in body.split("\n\n"):
        text = paragraph.strip()
        if not text:
            continue
        pdf.set_x(15)
        pdf.multi_cell(0, 5, _sanitize_pdf(text))
        pdf.ln(2)


def _section_heading(pdf, label: str) -> None:
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(*_AZURE_RGB)
    pdf.cell(0, 8, _sanitize_pdf(label), ln=1)
    pdf.set_draw_color(*_AZURE_RGB)
    pdf.set_line_width(0.4)
    y = pdf.get_y()
    pdf.line(15, y, 195, y)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(3)


def _render_cost_section(pdf, bundled: dict[str, Any]) -> None:
    pdf.add_page()
    _section_heading(pdf, "3. Cost + Quota")
    estimate = bundled.get("cost_estimate") or {}
    total = estimate.get("total_monthly_estimate")
    line_items = estimate.get("line_items") or []
    quota_constraints = bundled.get("quota_constraints") or []
    constrained_skus = {
        (c.get("sku"), c.get("region")) for c in quota_constraints if isinstance(c, dict)
    }

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(
        0,
        6,
        _sanitize_pdf(
            f"Total monthly estimate: ${total:,.2f}" if isinstance(total, (int, float)) else "Total monthly estimate: n/a"
        ),
        ln=1,
    )
    reservation_savings = estimate.get("reservation_monthly_savings")
    if isinstance(reservation_savings, (int, float)) and reservation_savings:
        pdf.set_font("Helvetica", size=9)
        pdf.cell(
            0,
            5,
            _sanitize_pdf(f"Reservation discounts applied: -${reservation_savings:,.2f}/mo"),
            ln=1,
        )
    pdf.ln(2)

    if line_items:
        headers = ("Service", "SKU", "Region", "Qty", "Hrs/mo", "Flag")
        widths = (44, 38, 26, 14, 22, 36)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(*_AZURE_RGB)
        pdf.set_text_color(255, 255, 255)
        for h, w in zip(headers, widths):
            pdf.cell(w, 6, _sanitize_pdf(h), border=0, fill=True)
        pdf.ln(6)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", size=7)
        for i, item in enumerate(line_items[:80]):
            fill = _CARD_RGB if i % 2 == 0 else _LIGHT_ROW_RGB
            pdf.set_fill_color(*fill)
            svc = str(item.get("service", ""))
            sku = str(item.get("sku", ""))
            region = str(item.get("region", ""))
            qty = item.get("quantity", "")
            hrs = item.get("hours_per_month", "")
            flag = "QUOTA" if (sku, region) in constrained_skus else ""
            pdf.cell(widths[0], 5, _sanitize_pdf(_truncate(svc, 28)), fill=True)
            pdf.cell(widths[1], 5, _sanitize_pdf(_truncate(sku, 24)), fill=True)
            pdf.cell(widths[2], 5, _sanitize_pdf(_truncate(region, 16)), fill=True)
            pdf.cell(widths[3], 5, _sanitize_pdf(str(qty)), fill=True)
            pdf.cell(widths[4], 5, _sanitize_pdf(str(hrs)), fill=True)
            if flag:
                pdf.set_text_color(200, 50, 50)
            pdf.cell(widths[5], 5, _sanitize_pdf(flag), fill=True)
            pdf.set_text_color(0, 0, 0)
            pdf.ln(5)
    else:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(*_MUTED_RGB)
        pdf.cell(0, 6, _sanitize_pdf("No cost line items captured."), ln=1)
        pdf.set_text_color(0, 0, 0)

    if quota_constraints:
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(200, 50, 50)
        pdf.cell(0, 6, _sanitize_pdf("Quota constraints"), ln=1)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", size=8)
        for c in quota_constraints:
            if not isinstance(c, dict):
                continue
            alts = c.get("alternatives") or []
            alt_str = ", ".join(
                f"{a.get('region')} ({a.get('available')})"
                for a in alts
                if isinstance(a, dict)
            )
            line = (
                f"{c.get('sku')} @ {c.get('region')}: requested {c.get('requested')}, "
                f"available {c.get('available')}. Alternatives: {alt_str or 'none'}."
            )
            pdf.set_x(15)
            pdf.multi_cell(0, 5, _sanitize_pdf(line))


def _render_waf_section(pdf, bundled: dict[str, Any]) -> None:
    pdf.add_page()
    _section_heading(pdf, "5. Well-Architected pillars")
    waf = bundled.get("waf") or {}
    pillars = waf.get("pillars") or []
    if not pillars:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(*_MUTED_RGB)
        pdf.cell(0, 6, _sanitize_pdf("(no WAF analysis captured)"), ln=1)
        pdf.set_text_color(0, 0, 0)
        return
    pdf.set_font("Helvetica", size=9)
    for pillar in pillars:
        if not isinstance(pillar, dict):
            continue
        name = pillar.get("pillar") or pillar.get("name") or "Pillar"
        score = pillar.get("score")
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(*_AZURE_RGB)
        header = name if score is None else f"{name}  -  score {score}"
        pdf.cell(0, 6, _sanitize_pdf(header), ln=1)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", size=9)
        text = pillar.get("text") or pillar.get("summary") or ""
        if text:
            pdf.set_x(15)
            pdf.multi_cell(0, 5, _sanitize_pdf(text))
        pdf.ln(2)


def _render_citations(pdf, citations: list[dict[str, Any]]) -> None:
    pdf.add_page()
    _section_heading(pdf, "6. Frozen citations")
    if not citations:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(*_MUTED_RGB)
        pdf.cell(0, 6, _sanitize_pdf("(no citations attached)"), ln=1)
        pdf.set_text_color(0, 0, 0)
        return
    pdf.set_font("Helvetica", size=8)
    for citation in citations[:200]:
        if not isinstance(citation, dict):
            continue
        artifact = citation.get("artifact") or "design"
        corpus = citation.get("corpus") or citation.get("corpus_type") or "—"
        url = citation.get("url") or citation.get("learn_url") or ""
        title = citation.get("title") or url or "(untitled)"
        freshness = citation.get("freshness_days")
        published = citation.get("published_at") or ""
        confidence = citation.get("confidence")

        pdf.set_font("Helvetica", "B", 8)
        pdf.set_x(15)
        pdf.cell(0, 5, _sanitize_pdf(f"[{artifact}] {_truncate(title, 80)}"), ln=1)
        pdf.set_font("Helvetica", size=7)
        pdf.set_text_color(*_MUTED_RGB)
        meta_bits = [f"corpus: {corpus}"]
        if published:
            meta_bits.append(f"published: {published}")
        if freshness is not None:
            meta_bits.append(f"{freshness}d old at freeze")
        if confidence is not None:
            meta_bits.append(f"conf {confidence}")
        pdf.set_x(15)
        pdf.multi_cell(0, 4, _sanitize_pdf("  ·  ".join(meta_bits)))
        if url:
            pdf.set_text_color(*_AZURE_RGB)
            pdf.set_x(15)
            pdf.multi_cell(0, 4, _sanitize_pdf(_truncate(url, 140)))
        pdf.set_text_color(0, 0, 0)
        pdf.ln(1)


def _render_inventory(pdf, inventory: dict[str, Any]) -> None:
    pdf.add_page()
    _section_heading(pdf, "7. Tenant inventory snapshot")
    total = inventory.get("total_documents") or 0
    if total == 0:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(*_MUTED_RGB)
        pdf.cell(
            0,
            6,
            _sanitize_pdf("No inventory captured (no subscriptions or scan skipped)."),
            ln=1,
        )
        pdf.set_text_color(0, 0, 0)
        return
    last_synced = inventory.get("last_synced_at") or "unknown"
    pdf.set_font("Helvetica", size=9)
    pdf.cell(
        0,
        5,
        _sanitize_pdf(f"{total} documents · last synced {last_synced}"),
        ln=1,
    )
    pdf.ln(2)

    by_kind = inventory.get("by_fact_kind") or {}
    if by_kind:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 5, _sanitize_pdf("Facts by kind"), ln=1)
        pdf.set_font("Helvetica", size=8)
        for kind, count in by_kind.items():
            pdf.cell(0, 4, _sanitize_pdf(f"  · {kind}: {count}"), ln=1)
        pdf.ln(2)

    by_type = inventory.get("by_resource_type") or {}
    if by_type:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 5, _sanitize_pdf("Top resource types"), ln=1)
        pdf.set_font("Helvetica", size=8)
        for rtype, count in list(by_type.items())[:25]:
            pdf.cell(0, 4, _sanitize_pdf(f"  · {rtype}: {count}"), ln=1)


def _render_reviewer_worksheet(pdf, conditions: list[dict[str, Any]]) -> None:
    pdf.add_page()
    _section_heading(pdf, "8. Reviewer worksheet")
    pdf.set_font("Helvetica", size=9)
    pdf.multi_cell(
        0,
        5,
        _sanitize_pdf(
            "Document any conditions that must be cleared before this design is "
            "deployed. Each condition will be tracked in the ARB submission until "
            "explicitly cleared or waived."
        ),
    )
    pdf.ln(3)

    if conditions:
        headers = ("Severity", "Status", "Owner", "Due", "Condition")
        widths = (22, 22, 32, 24, 80)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(*_AZURE_RGB)
        pdf.set_text_color(255, 255, 255)
        for h, w in zip(headers, widths):
            pdf.cell(w, 6, _sanitize_pdf(h), border=0, fill=True)
        pdf.ln(6)
        pdf.set_text_color(0, 0, 0)
        for i, cond in enumerate(conditions):
            fill = _CARD_RGB if i % 2 == 0 else _LIGHT_ROW_RGB
            pdf.set_fill_color(*fill)
            sev = (cond.get("severity") or "minor").lower()
            status = (cond.get("status") or "open").lower()
            owner = cond.get("owner") or "—"
            due = _fmt_ts(cond.get("due_date"))
            text = cond.get("text") or ""

            pdf.set_font("Helvetica", "B", 7)
            sev_rgb = _SEVERITY_RGB.get(sev, (100, 100, 100))
            pdf.set_text_color(*sev_rgb)
            pdf.cell(widths[0], 5, _sanitize_pdf(sev.upper()), fill=True)
            status_rgb = _STATUS_RGB.get(status, (100, 100, 100))
            pdf.set_text_color(*status_rgb)
            pdf.cell(widths[1], 5, _sanitize_pdf(status.upper()), fill=True)
            pdf.set_text_color(0, 0, 0)
            pdf.set_font("Helvetica", size=7)
            pdf.cell(widths[2], 5, _sanitize_pdf(_truncate(owner, 22)), fill=True)
            pdf.cell(widths[3], 5, _sanitize_pdf(due[:10]), fill=True)
            pdf.cell(widths[4], 5, _sanitize_pdf(_truncate(text, 60)), fill=True)
            pdf.ln(5)
    else:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(*_MUTED_RGB)
        pdf.cell(0, 6, _sanitize_pdf("(no conditions filed)"), ln=1)
        pdf.set_text_color(0, 0, 0)

    pdf.ln(8)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, _sanitize_pdf("Reviewer signature"), ln=1)
    pdf.set_font("Helvetica", size=9)
    pdf.set_draw_color(*_MUTED_RGB)
    y = pdf.get_y() + 12
    pdf.line(15, y, 110, y)
    pdf.line(125, y, 195, y)
    pdf.set_xy(15, y + 1)
    pdf.set_text_color(*_MUTED_RGB)
    pdf.cell(95, 4, _sanitize_pdf("Reviewer name + role"))
    pdf.set_xy(125, y + 1)
    pdf.cell(70, 4, _sanitize_pdf("Date"))
    pdf.set_text_color(0, 0, 0)
