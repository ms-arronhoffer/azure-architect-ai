import html as html_module
from datetime import datetime
from typing import Optional

import markdown as md
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter()


class CostLineItem(BaseModel):
    service: str
    sku: Optional[str] = None
    region: Optional[str] = None
    quantity: float = 1
    monthly_estimate: Optional[float] = None


class CostEstimateBody(BaseModel):
    line_items: list[CostLineItem] = []
    total_monthly_estimate: float = 0
    currency: str = "USD"
    disclaimer: str = ""
    optimization_tips: list[str] = []


class HandoffRequest(BaseModel):
    title: str = "Azure Architecture Handoff"
    description: str = ""
    diagram_xml: Optional[str] = None
    runbook: Optional[str] = None
    bicep_code: Optional[str] = None
    param_file: Optional[str] = None
    deploy_commands: list[str] = []
    cost_estimate: Optional[CostEstimateBody] = None
    waf_scores: Optional[dict] = None


def _md(text: str) -> str:
    return md.markdown(text, extensions=["tables", "fenced_code"])


def _cost_table(est: CostEstimateBody) -> str:
    rows = "".join(
        f"<tr><td>{html_module.escape(item.service)}</td>"
        f"<td>{html_module.escape(item.sku or '—')}</td>"
        f"<td>{html_module.escape(item.region or '—')}</td>"
        f"<td>{item.quantity}</td>"
        f"<td>{'$' + f'{item.monthly_estimate:,.2f}' if item.monthly_estimate is not None else '—'}</td></tr>"
        for item in est.line_items
    )
    tips = ""
    if est.optimization_tips:
        tip_items = "".join(f"<li>{html_module.escape(t)}</li>" for t in est.optimization_tips)
        tips = f"<h4>Optimization Tips</h4><ul>{tip_items}</ul>"
    return f"""
<table>
  <thead><tr><th>Service</th><th>SKU</th><th>Region</th><th>Qty</th><th>$/mo</th></tr></thead>
  <tbody>{rows}
    <tr class="total"><td colspan="4"><strong>Total</strong></td><td><strong>${est.total_monthly_estimate:,.2f}</strong></td></tr>
  </tbody>
</table>
{tips}
<p class="disclaimer">{html_module.escape(est.disclaimer)}</p>
"""


def _waf_table(scores: dict) -> str:
    labels = {
        "reliability": "Reliability", "security": "Security",
        "cost": "Cost Optimization", "operations": "Operational Excellence",
        "performance": "Performance Efficiency",
    }
    rows = "".join(
        f"<tr><td>{labels.get(k, k.capitalize())}</td>"
        f"<td><span class='score score-{v}'>{v}/5</span></td></tr>"
        for k, v in scores.items()
    )
    return f"<table><thead><tr><th>Pillar</th><th>Score</th></tr></thead><tbody>{rows}</tbody></table>"


def _diagram_section(xml: str) -> str:
    encoded = html_module.escape(xml, quote=True)
    viewer_url = f"https://viewer.diagrams.net/?xml={encoded}"
    return f"""
<p>
  <a href="{viewer_url}" target="_blank" rel="noopener noreferrer" class="btn">
    &#128065; View Diagram in browser
  </a>
</p>
<details>
  <summary>Raw draw.io XML</summary>
  <pre><code>{html_module.escape(xml)}</code></pre>
</details>
"""


@router.post("/export/handoff")
async def export_handoff(req: HandoffRequest):
    generated_date = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    sections = ""

    if req.description:
        sections += f"<section><h2>Architecture Overview</h2>{_md(req.description)}</section>"

    if req.diagram_xml:
        sections += f"<section><h2>Architecture Diagram</h2>{_diagram_section(req.diagram_xml)}</section>"

    if req.waf_scores:
        sections += f"<section><h2>Well-Architected Framework Scores</h2>{_waf_table(req.waf_scores)}</section>"

    if req.cost_estimate:
        sections += f"<section><h2>Cost Estimate</h2>{_cost_table(req.cost_estimate)}</section>"

    if req.runbook:
        sections += f"<section><h2>Deployment Runbook</h2>{_md(req.runbook)}</section>"

    if req.bicep_code:
        cmds = ""
        if req.deploy_commands:
            cmd_lines = html_module.escape("\n".join(req.deploy_commands))
            cmds = f"<h4>Deploy Commands</h4><pre><code>{cmd_lines}</code></pre>"
        param = ""
        if req.param_file:
            param = f"<h4>main.bicepparam</h4><pre><code>{html_module.escape(req.param_file)}</code></pre>"
        sections += f"""<section><h2>Infrastructure as Code (Bicep)</h2>
<h4>main.bicep</h4>
<pre><code>{html_module.escape(req.bicep_code)}</code></pre>
{param}{cmds}</section>"""

    doc_title = html_module.escape(req.title)
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{doc_title}</title>
<style>
  :root {{
    --blue: #0078d4;
    --dark: #1b1b1b;
    --mid: #444;
    --light: #f4f4f4;
    --border: #d0d0d0;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    color: var(--dark);
    background: #fff;
    line-height: 1.6;
  }}
  header {{
    background: var(--blue);
    color: #fff;
    padding: 24px 40px;
  }}
  header h1 {{ font-size: 24px; font-weight: 700; }}
  header .meta {{ font-size: 12px; opacity: 0.8; margin-top: 4px; }}
  main {{ max-width: 960px; margin: 0 auto; padding: 32px 40px; }}
  section {{ margin-bottom: 40px; }}
  h2 {{
    font-size: 18px; font-weight: 700;
    border-bottom: 2px solid var(--blue);
    padding-bottom: 6px; margin-bottom: 16px;
    color: var(--blue);
  }}
  h3, h4 {{ font-size: 14px; font-weight: 600; margin: 16px 0 8px; }}
  p {{ margin: 8px 0; }}
  ul, ol {{ padding-left: 20px; margin: 8px 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 12px 0; }}
  th, td {{ border: 1px solid var(--border); padding: 8px 12px; text-align: left; font-size: 13px; }}
  th {{ background: var(--light); font-weight: 600; }}
  tr.total {{ background: var(--light); }}
  pre {{
    background: #f8f8f8; border: 1px solid var(--border);
    border-radius: 4px; padding: 12px 16px;
    overflow-x: auto; font-size: 12px;
    margin: 8px 0;
  }}
  code {{ font-family: "Cascadia Code", "Consolas", monospace; }}
  details {{ margin: 8px 0; }}
  details summary {{ cursor: pointer; color: var(--blue); font-size: 13px; }}
  .btn {{
    display: inline-block;
    background: var(--blue); color: #fff;
    padding: 8px 16px; border-radius: 4px;
    text-decoration: none; font-size: 13px;
  }}
  .score {{
    display: inline-block;
    padding: 2px 8px; border-radius: 10px;
    font-weight: 700; font-size: 12px;
  }}
  .score-1, .score-2 {{ background: #fde7e9; color: #c50e0e; }}
  .score-3 {{ background: #fff4ce; color: #835f00; }}
  .score-4, .score-5 {{ background: #dff6dd; color: #107c10; }}
  .disclaimer {{ font-size: 11px; color: #666; margin-top: 8px; }}
  @media print {{
    header {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    .btn {{ display: none; }}
    pre {{ white-space: pre-wrap; word-break: break-all; }}
  }}
</style>
</head>
<body>
<header>
  <h1>{doc_title}</h1>
  <div class="meta">Generated {generated_date} · Azure Architect AI</div>
</header>
<main>
{sections}
</main>
</body>
</html>"""

    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in req.title)[:60]
    filename = f"{safe_title.replace(' ', '_')}_handoff.html"
    return Response(
        content=html,
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Architecture Brief ─────────────────────────────────────────────────────────

class WorkloadSpecBody(BaseModel):
    name: str = ""
    type: str = ""
    criticality: str = ""
    primaryRegion: str = ""
    availabilitySla: str = ""
    rtoHours: float = 0
    rpoHours: float = 0
    complianceFrameworks: list[str] = []
    dataClassification: str = ""
    monthlyBudgetUsd: float = 0
    teamSize: str = ""


class BriefRequest(BaseModel):
    workload_spec: Optional[WorkloadSpecBody] = None
    architecture_text: str = ""
    diagram_xml: Optional[str] = None
    bicep_code: Optional[str] = None
    runbook: Optional[str] = None
    waf_pillars: list[dict] = []
    sizing_text: str = ""
    security_text: str = ""
    cost_estimate: Optional[CostEstimateBody] = None


@router.post("/export/brief")
async def export_brief(req: BriefRequest):
    generated_date = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    spec = req.workload_spec
    title = html_module.escape(spec.name if spec else "Azure Architecture Brief")

    # Requirements summary section
    req_section = ""
    if spec and spec.name:
        rows = ""
        if spec.type: rows += f"<tr><td>Type</td><td>{html_module.escape(spec.type)}</td></tr>"
        if spec.criticality: rows += f"<tr><td>Criticality</td><td>{html_module.escape(spec.criticality)}</td></tr>"
        if spec.primaryRegion: rows += f"<tr><td>Primary Region</td><td>{html_module.escape(spec.primaryRegion)}</td></tr>"
        if spec.availabilitySla: rows += f"<tr><td>Availability SLA</td><td>{spec.availabilitySla}%</td></tr>"
        if spec.rtoHours: rows += f"<tr><td>RTO</td><td>{spec.rtoHours} hours</td></tr>"
        if spec.rpoHours: rows += f"<tr><td>RPO</td><td>{spec.rpoHours} hours</td></tr>"
        if spec.complianceFrameworks: rows += f"<tr><td>Compliance</td><td>{html_module.escape(', '.join(spec.complianceFrameworks))}</td></tr>"
        if spec.dataClassification: rows += f"<tr><td>Data Classification</td><td>{html_module.escape(spec.dataClassification)}</td></tr>"
        if spec.monthlyBudgetUsd: rows += f"<tr><td>Monthly Budget</td><td>${spec.monthlyBudgetUsd:,.0f}</td></tr>"
        if spec.teamSize: rows += f"<tr><td>Team</td><td>{html_module.escape(spec.teamSize)}</td></tr>"
        req_section = f"<section><h2>Workload Requirements</h2><table><tbody>{rows}</tbody></table></section>"

    sections = req_section

    if req.architecture_text:
        sections += f"<section><h2>Architecture Design</h2>{_md(req.architecture_text)}</section>"

    if req.diagram_xml:
        sections += f"<section><h2>Architecture Diagram</h2>{_diagram_section(req.diagram_xml)}</section>"

    if req.waf_pillars:
        pillar_rows = ""
        for p in req.waf_pillars:
            score = p.get("score", 0)
            pillar = html_module.escape(str(p.get("pillar", "")))
            recs = "; ".join(html_module.escape(r) for r in p.get("recommendations", [])[:3])
            pillar_rows += f"<tr><td>{pillar}</td><td><span class='score score-{score}'>{score}/5</span></td><td style='font-size:12px'>{recs}</td></tr>"
        sections += f"""<section><h2>Well-Architected Assessment</h2>
<table><thead><tr><th>Pillar</th><th>Score</th><th>Top Recommendations</th></tr></thead>
<tbody>{pillar_rows}</tbody></table></section>"""

    if req.cost_estimate:
        sections += f"<section><h2>Cost Estimate</h2>{_cost_table(req.cost_estimate)}</section>"

    if req.sizing_text:
        sections += f"<section><h2>Capacity Sizing</h2>{_md(req.sizing_text)}</section>"

    if req.security_text:
        sections += f"<section><h2>Security & Identity</h2>{_md(req.security_text)}</section>"

    if req.runbook:
        sections += f"<section><h2>Deployment Runbook</h2>{_md(req.runbook)}</section>"

    if req.bicep_code:
        sections += f"""<section><h2>Infrastructure as Code (Bicep)</h2>
<pre><code>{html_module.escape(req.bicep_code)}</code></pre></section>"""

    doc_title = title
    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{doc_title} — Architecture Brief</title>
<style>
  :root {{ --blue: #0078d4; --dark: #1b1b1b; --light: #f4f4f4; --border: #d0d0d0; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: "Segoe UI", system-ui, sans-serif; font-size: 14px; color: var(--dark); background: #fff; line-height: 1.6; }}
  header {{ background: linear-gradient(135deg, #0078d4 0%, #106ebe 100%); color: #fff; padding: 32px 48px; }}
  header h1 {{ font-size: 28px; font-weight: 700; }}
  header .sub {{ font-size: 13px; opacity: 0.8; margin-top: 6px; }}
  main {{ max-width: 960px; margin: 0 auto; padding: 40px 48px; }}
  section {{ margin-bottom: 48px; }}
  h2 {{ font-size: 18px; font-weight: 700; border-bottom: 2px solid var(--blue); padding-bottom: 6px; margin-bottom: 16px; color: var(--blue); }}
  h3, h4 {{ font-size: 14px; font-weight: 600; margin: 16px 0 8px; }}
  p {{ margin: 8px 0; }} ul, ol {{ padding-left: 20px; margin: 8px 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 12px 0; }}
  th, td {{ border: 1px solid var(--border); padding: 8px 12px; text-align: left; font-size: 13px; }}
  th {{ background: var(--light); font-weight: 600; }}
  pre {{ background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 12px; margin: 12px 0; }}
  code {{ font-family: "Cascadia Code", "Consolas", monospace; }}
  .score {{ display: inline-block; padding: 2px 8px; border-radius: 10px; font-weight: 700; font-size: 12px; }}
  .score-1, .score-2 {{ background: #fde7e9; color: #c50e0e; }}
  .score-3 {{ background: #fff4ce; color: #835f00; }}
  .score-4, .score-5 {{ background: #dff6dd; color: #107c10; }}
  .disclaimer {{ font-size: 11px; color: #666; margin-top: 8px; }}
  @media print {{ header {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }} pre {{ white-space: pre-wrap; }} }}
</style>
</head>
<body>
<header>
  <h1>{doc_title} — Architecture Brief</h1>
  <div class="sub">Generated {generated_date} · Azure Architect AI</div>
</header>
<main>
{sections}
</main>
</body>
</html>"""

    safe_name = "".join(c if c.isalnum() or c in " -_" else "_" for c in (spec.name if spec else "brief"))[:50]
    filename = f"{safe_name.replace(' ', '_')}_architecture_brief.html"
    return Response(
        content=html_doc,
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

