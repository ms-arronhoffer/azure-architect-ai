"""
HLS CSA Org Tracker report generation service.

Accepts three input files (xlsx or csv):
  1. Manager List — TPID, Account Name, Azure CSA M
  2. ACR Data    — multi-month Power BI export (FY26-Jul … FY26-Jun)
  3. OU Data     — customer deployment inventory (us_hls.csv schema)

Automatically selects the last full calendar month's ACR column
(e.g. June 13 → FY26-May) and produces the 9-section markdown report.

All core risk logic is ported from model-iq/mcp/model-data/src/scorecard.ts.
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

_RETIREMENTS_FILE = Path(__file__).parent.parent / "data" / "model_iq" / "retirements.json"

RISK_WEIGHTS: dict[str, int] = {
    "overdue": 1_000_000,
    "critical": 500_000,
    "warning": 100_000,
    "watch": 10_000,
    "ok": 0,
}

RISK_EMOJI: dict[str, str] = {
    "overdue": "⚫",
    "critical": "🔴",
    "warning": "🟡",
    "watch": "🟢",
    "ok": "🟢",
}


# ─── File Loading ────────────────────────────────────────────────────────────


def _xlsx_to_raw_rows(data: bytes) -> list[list[Any]]:
    import openpyxl  # type: ignore[import]

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.active
    rows = [list(row) for row in ws.iter_rows(values_only=True)]
    wb.close()
    return rows


def _csv_to_raw_rows(data: bytes) -> list[list[str]]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252")
    return [list(row) for row in csv.reader(io.StringIO(text))]


def load_file(data: bytes, filename: str) -> list[dict]:
    """Generic loader: xlsx or csv with row 1 as headers → list[dict]."""
    rows = _xlsx_to_raw_rows(data) if filename.lower().endswith(".xlsx") else _csv_to_raw_rows(data)
    if not rows:
        return []
    headers = [str(h).strip() if h is not None else "" for h in rows[0]]
    result = []
    for row in rows[1:]:
        d = {h: (str(row[i]).strip() if i < len(row) and row[i] is not None else "") for i, h in enumerate(headers)}
        result.append(d)
    return result


# ─── ACR Month Detection ─────────────────────────────────────────────────────


def get_last_full_month_column(today: date) -> str:
    """Return the Power BI column label for the last fully completed month.

    June 13 2026 → 'FY26-May'
    Microsoft FY: Jul 1 → Jun 30  (FY = calendar_year+1 when month ≥ 7)
    """
    last = today.replace(day=1) - timedelta(days=1)
    fy = last.year if last.month <= 6 else last.year + 1
    return f"FY{str(fy)[2:]}-{last.strftime('%b')}"


# ─── ACR Parsing ─────────────────────────────────────────────────────────────


def _parse_acr_value(raw: Any) -> float:
    if raw is None:
        return 0.0
    cleaned = str(raw).strip().replace("$", "").replace(",", "")
    if not cleaned or cleaned in ("-", "nan", "NaN"):
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def parse_acr_data(data: bytes, filename: str, month_col: str) -> dict[str, float]:
    """Parse ACR multi-month file → {ACCOUNT_NAME_UPPER: monthly_acr_float}.

    ACR6.csv layout:
      Row 0: FiscalMonth,,FY26-Jul,…,FY26-May,…,Total
      Row 1: TPAccountName,ServiceCompGrouping,$ ACR,…   ← label row (skip)
      Row 2+: ABBOTT LABORATORIES,Total,"$37,027",…
    """
    rows = _xlsx_to_raw_rows(data) if filename.lower().endswith(".xlsx") else _csv_to_raw_rows(data)
    if not rows:
        return {}

    # Locate the header row (first row whose cell 0 is "FiscalMonth")
    header_row_idx: int | None = None
    for i, row in enumerate(rows):
        if row and str(row[0]).strip().lower() == "fiscalmonth":
            header_row_idx = i
            break

    if header_row_idx is None:
        raise ValueError("ACR file: cannot find a row with 'FiscalMonth' in column 0")

    headers = [str(c).strip() if c is not None else "" for c in rows[header_row_idx]]

    if month_col not in headers:
        fy_cols = [h for h in headers if h.startswith("FY")]
        raise ValueError(
            f"ACR column '{month_col}' not found in file. "
            f"Available FY columns: {fy_cols}"
        )

    col_idx = headers.index(month_col)

    result: dict[str, float] = {}
    for row in rows[header_row_idx + 2:]:  # skip header row + label row
        if not row or len(row) < 2:
            continue
        name = str(row[0]).strip() if row[0] is not None else ""
        grouping = str(row[1]).strip() if len(row) > 1 and row[1] is not None else ""
        if not name or grouping != "Total":
            continue
        val = row[col_idx] if len(row) > col_idx else ""
        result[name.upper()] = _parse_acr_value(val)

    return result


# ─── Org Mapping ─────────────────────────────────────────────────────────────


def _normalize_tpid(raw: Any) -> str:
    if raw is None or str(raw).strip() in ("", "NaN", "nan"):
        return ""
    try:
        n = float(str(raw))
        if n != n:  # NaN
            return ""
        return str(int(n))
    except (ValueError, TypeError):
        return str(raw).strip()


def _find_col(headers: list[str], candidates: list[str]) -> str | None:
    lower = {h.lower().strip(): h for h in headers}
    for c in candidates:
        if c.lower() in lower:
            return lower[c.lower()]
    return None


def build_org_map(rows: list[dict]) -> tuple[dict, dict[str, list[str]]]:
    """Build org_map and account_directors from Manager List rows.

    Returns:
      org_map            — {director_alias → {accounts: [{tpid, name}]}}
      account_directors  — {tpid → ordered list of director aliases}
    """
    if not rows:
        return {}, {}

    headers = list(rows[0].keys())
    tpid_col = _find_col(headers, ["TPID", "tpid", "Top Parent ID"])
    name_col = _find_col(headers, ["Account Name", "TP Name", "account name"])
    dir_col = _find_col(headers, ["Azure CSA M", "azure csa m", "Director", "Manager"])

    if not tpid_col or not name_col or not dir_col:
        raise ValueError(
            f"Manager List is missing required columns (TPID, Account Name, Azure CSA M). "
            f"Found: {headers}"
        )

    org_map: dict[str, dict] = {}
    account_directors: dict[str, list[str]] = {}
    seen_per_dir: dict[str, set[str]] = {}

    for row in rows:
        raw_tpid = row.get(tpid_col, "").strip()
        raw_name = row.get(name_col, "").strip()
        raw_dir = row.get(dir_col, "").strip()

        if not raw_tpid or not raw_dir:
            continue

        tpid = _normalize_tpid(raw_tpid)
        if not tpid:
            continue

        # Maintain insertion-order director list per account
        if tpid not in account_directors:
            account_directors[tpid] = []
        if raw_dir not in account_directors[tpid]:
            account_directors[tpid].append(raw_dir)

        # Director → accounts (dedup by TPID)
        if raw_dir not in org_map:
            org_map[raw_dir] = {"accounts": []}
            seen_per_dir[raw_dir] = set()

        if tpid not in seen_per_dir[raw_dir]:
            seen_per_dir[raw_dir].add(tpid)
            org_map[raw_dir]["accounts"].append({"tpid": tpid, "name": raw_name})

    return org_map, account_directors


# ─── Deployment Parsing ──────────────────────────────────────────────────────


def parse_deployments(rows: list[dict]) -> list[dict]:
    result = []
    for row in rows:
        dep = dict(row)
        dep["_tpid"] = _normalize_tpid(dep.get("TPID", ""))
        result.append(dep)
    return result


def build_tpid_index(deployments: list[dict]) -> dict[str, list[dict]]:
    index: dict[str, list[dict]] = {}
    for dep in deployments:
        tpid = dep.get("_tpid", "")
        if not tpid:
            continue
        index.setdefault(tpid, []).append(dep)
    return index


def build_name_to_tpid(deployments: list[dict]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for dep in deployments:
        name = dep.get("TP Name", "").strip().upper()
        tpid = dep.get("_tpid", "")
        if name and tpid and name not in mapping:
            mapping[name] = tpid
    return mapping


# ─── Retirement Lookup ───────────────────────────────────────────────────────


def load_retirements() -> tuple[dict[str, date], dict[str, str]]:
    """Load retirements.json → (lookup, replacements).

    lookup      — {model_id_lower: earliest_date, 'model|version': date}
    replacements — {model_id_lower: cleaned_replacement_hint}
    """
    if not _RETIREMENTS_FILE.exists():
        return {}, {}

    raw = json.loads(_RETIREMENTS_FILE.read_text(encoding="utf-8"))
    models = raw.get("models", raw) if isinstance(raw, dict) else raw

    lookup: dict[str, date] = {}
    replacements: dict[str, str] = {}

    for r in models:
        model_id = (r.get("modelId") or "").lower().strip()
        if not model_id:
            continue

        ret_str = (r.get("retirementDate") or "").strip()
        if not ret_str:
            continue
        cleaned_date = re.sub(r"^No earlier than\s+", "", ret_str, flags=re.IGNORECASE).strip()[:10]
        try:
            ret_date = date.fromisoformat(cleaned_date)
        except ValueError:
            continue

        # Version-specific key
        version = str(r.get("version") or "").strip()
        if version and version.lower() != "none" and version != "null":
            lookup[f"{model_id}|{version}"] = ret_date

        # Model-level key: keep earliest date (most conservative)
        existing = lookup.get(model_id)
        if existing is None or ret_date < existing:
            lookup[model_id] = ret_date

        # Replacement hint (first one wins)
        hints = r.get("replacementHints") or []
        if hints and model_id not in replacements:
            hint = re.sub(r"\s+version:.*$", "", str(hints[0]), flags=re.IGNORECASE).strip()
            if hint:
                replacements[model_id] = hint

    return lookup, replacements


# ─── Risk Classification (port of scorecard.ts) ──────────────────────────────


def parse_token_tier(val: Any) -> int:
    """-1 = unknown, 0 = none, 1 = low, 2 = medium, 3 = high, 4 = very-high."""
    if val is None:
        return -1
    s = str(val).strip()
    if not s or s == "NaN":
        return -1
    if s.startswith("0"):
        return 0
    if s.startswith("1"):
        return 1
    if s.startswith("2"):
        return 2
    if s.startswith("3"):
        return 3
    if s.startswith("4"):
        return 4
    return -1


def is_ptu(dep: dict) -> bool:
    return "provision" in str(dep.get("OfferingName", "")).lower()


def is_active_deployment(dep: dict) -> bool:
    """Active = Week-1 Medium+ (tier ≥ 2) OR PTU provisioned capacity."""
    return is_ptu(dep) or parse_token_tier(dep.get("Tokens Week-1")) >= 2


def _epoch_day(d: date) -> int:
    from datetime import datetime
    return (datetime(d.year, d.month, d.day) - datetime(1970, 1, 1)).days


def classify_risk(
    model: str,
    version: str,
    ret_lookup: dict[str, date],
    pbi_date: str,
    today: date,
) -> tuple[str, int | None]:
    """Classify a single deployment's retirement risk.

    Returns (level, days_remaining).
    Priority: version-specific lookup > model-level lookup > PBI date field.
    """
    key = (model or "").lower().strip()
    if not key:
        return "ok", None

    ret_date: date | None = None
    if version:
        ret_date = ret_lookup.get(f"{key}|{version.strip()}")
    if ret_date is None:
        ret_date = ret_lookup.get(key)
    if ret_date is None and pbi_date:
        cleaned = re.sub(r"^No earlier than\s+", "", pbi_date, flags=re.IGNORECASE).strip()[:10]
        try:
            ret_date = date.fromisoformat(cleaned)
        except ValueError:
            pass

    if ret_date is None:
        return "ok", None

    days = _epoch_day(ret_date) - _epoch_day(today)

    if days <= 0:
        return "overdue", days
    if days <= 90:
        return "critical", days
    if days <= 180:
        return "warning", days
    if days <= 365:
        return "watch", days
    return "ok", days


def compute_account_risk(
    name: str,
    tpid: str,
    deps: list[dict],
    ret_lookup: dict[str, date],
    today: date,
    monthly_acr: float = 0.0,
) -> dict:
    """Aggregate risk across all deployments for one account."""
    overdue = critical = warning = watch = 0
    min_days: int | None = None
    risk_models: set[str] = set()
    active_at_risk = 0

    for dep in deps:
        model = str(dep.get("Model", "")).strip()
        version = str(dep.get("Version") or "").strip()
        pbi_date = str(dep.get("Retirement Date") or "").strip()
        if pbi_date == "NaN":
            pbi_date = ""

        level, days = classify_risk(model, version, ret_lookup, pbi_date, today)

        if level == "overdue":
            overdue += 1
            risk_models.add(model)
        elif level == "critical":
            critical += 1
            risk_models.add(model)
        elif level == "warning":
            warning += 1
            risk_models.add(model)
        elif level == "watch":
            watch += 1
            risk_models.add(model)

        if level in ("overdue", "critical", "warning") and is_active_deployment(dep):
            active_at_risk += 1

        if days is not None and level != "ok" and (min_days is None or days < min_days):
            min_days = days

    if overdue > 0:
        acct_level = "overdue"
    elif critical > 0:
        acct_level = "critical"
    elif warning > 0:
        acct_level = "warning"
    elif watch > 0:
        acct_level = "watch"
    else:
        acct_level = "ok"

    priority_score = monthly_acr + RISK_WEIGHTS[acct_level]

    return {
        "name": name,
        "tpid": tpid,
        "totalDeployments": len(deps),
        "overdue": overdue,
        "critical": critical,
        "warning": warning,
        "watch": watch,
        "level": acct_level,
        "minDays": min_days,
        "atRiskModels": sorted(risk_models),
        "monthlyAcr": monthly_acr,
        "annualAcr": monthly_acr * 12,
        "priorityScore": priority_score,
        "activeAtRisk": active_at_risk,
        "directors": [],  # populated by build_org_scorecard
    }


# ─── Org Scorecard ───────────────────────────────────────────────────────────


def build_org_scorecard(
    org_map: dict,
    account_directors: dict[str, list[str]],
    tpid_index: dict[str, list[dict]],
    ret_lookup: dict[str, date],
    acr_by_name: dict[str, float],
    name_to_tpid: dict[str, str],
    today: date,
) -> dict:
    """Build the full org scorecard matching generateOrgScorecard() from scorecard.ts."""
    # Match ACR account names → TPIDs
    acr_map: dict[str, float] = {}
    for name_upper, acr in acr_by_name.items():
        tpid = name_to_tpid.get(name_upper)
        if tpid:
            acr_map[tpid] = acr_map.get(tpid, 0.0) + acr

    # Process all accounts, dedup by TPID (keep highest priority score)
    all_accounts_map: dict[str, dict] = {}
    for director, data in org_map.items():
        for acct in data["accounts"]:
            tpid = acct["tpid"]
            deps = tpid_index.get(tpid, [])
            if not deps:
                continue
            monthly_acr = acr_map.get(tpid, 0.0)
            risk = compute_account_risk(acct["name"], tpid, deps, ret_lookup, today, monthly_acr)
            risk["directors"] = account_directors.get(tpid, [director])

            existing = all_accounts_map.get(tpid)
            if existing is None or risk["priorityScore"] > existing["priorityScore"]:
                all_accounts_map[tpid] = risk

    all_accounts = sorted(all_accounts_map.values(), key=lambda a: -a["priorityScore"])
    top5 = all_accounts[:5]

    # Director-group summary (Section 3): group accounts by combined director set
    dir_group: dict[str, list[dict]] = {}
    for acct in all_accounts:
        dir_key = ", ".join(acct["directors"])
        dir_group.setdefault(dir_key, []).append(acct)

    director_summaries = []
    for dir_key, accts in dir_group.items():
        od = sum(1 for a in accts if a["level"] == "overdue")
        cr = sum(1 for a in accts if a["level"] == "critical")
        wn = sum(1 for a in accts if a["level"] == "warning")
        dir_level = "overdue" if od > 0 else "critical" if cr > 0 else "warning" if wn > 0 else "ok"
        director_summaries.append({
            "director": dir_key,
            "accounts": len(accts),
            "deployments": sum(a["totalDeployments"] for a in accts),
            "monthlyAcr": sum(a["monthlyAcr"] for a in accts),
            "overdue": od,
            "critical": cr,
            "warning": wn,
            "level": dir_level,
        })
    director_summaries.sort(key=lambda d: -d["monthlyAcr"])

    # Totals
    total_monthly = sum(a["monthlyAcr"] for a in all_accounts)
    od_accounts = [a for a in all_accounts if a["level"] == "overdue"]
    cr_accounts = [a for a in all_accounts if a["level"] == "critical"]
    wn_accounts = [a for a in all_accounts if a["level"] == "warning"]

    # Count unique directors in org map vs those with deployed accounts
    all_dir_with_deps = {d for acct in all_accounts for d in acct["directors"]}

    return {
        "allAccounts": all_accounts,
        "top5": top5,
        "directorSummaries": director_summaries,
        "totals": {
            "directorsInOrg": len(org_map),
            "directorsWithDeployments": len(all_dir_with_deps),
            "accountsWithDeployments": len(all_accounts),
            "totalDeployments": sum(a["totalDeployments"] for a in all_accounts),
            "totalMonthlyAcr": total_monthly,
            "overdue": len(od_accounts),
            "critical": len(cr_accounts),
            "warning": len(wn_accounts),
            "ok": len(all_accounts) - len(od_accounts) - len(cr_accounts) - len(wn_accounts),
            "overdueAcr": sum(a["monthlyAcr"] for a in od_accounts),
            "criticalAcr": sum(a["monthlyAcr"] for a in cr_accounts),
            "warningAcr": sum(a["monthlyAcr"] for a in wn_accounts),
        },
    }


def build_model_fleet_summary(
    tpid_index: dict[str, list[dict]],
    ret_lookup: dict[str, date],
    ret_replacements: dict[str, str],
    today: date,
) -> list[dict]:
    """Fleet-wide model retirement exposure (≤180 days, Section 4)."""
    model_data: dict[str, dict] = {}

    for deps in tpid_index.values():
        for dep in deps:
            model = str(dep.get("Model", "")).strip()
            version = str(dep.get("Version") or "").strip()
            pbi_date = str(dep.get("Retirement Date") or "").strip()
            if pbi_date == "NaN":
                pbi_date = ""
            tpid = dep.get("_tpid", "")

            level, days = classify_risk(model, version, ret_lookup, pbi_date, today)
            if level not in ("overdue", "critical", "warning") or days is None:
                continue

            key = model.lower()
            if key not in model_data:
                # Model-level retirement date for display
                ret_date = ret_lookup.get(key)
                model_data[key] = {
                    "model": model,
                    "retirementDate": ret_date.isoformat() if ret_date else "",
                    "days": days,
                    "deploys": 0,
                    "accounts": set(),
                    "replacement": ret_replacements.get(key, ""),
                }

            # Track most-urgent days
            if days < model_data[key]["days"]:
                model_data[key]["days"] = days

            model_data[key]["deploys"] += 1
            model_data[key]["accounts"].add(tpid)

    result = []
    for stat in model_data.values():
        result.append({
            "model": stat["model"],
            "retirementDate": stat["retirementDate"],
            "days": stat["days"],
            "hlsDeploys": stat["deploys"],
            "hlsAccounts": len(stat["accounts"]),
            "replacement": stat["replacement"] or "—",
        })

    result.sort(key=lambda m: m["days"])
    return result


# ─── Report Rendering ────────────────────────────────────────────────────────


def _fmt_acr(amount: float) -> str:
    return f"${amount:,.0f}"


def _fmt_fy(monthly: float) -> str:
    annual = monthly * 12
    if annual >= 1_000_000:
        return f"${annual / 1_000_000:.1f}M"
    if annual >= 1_000:
        return f"${annual / 1_000:.0f}K"
    return f"${annual:.0f}"


def _fmt_days(days: int | None) -> str:
    if days is None:
        return "—"
    return f"{days}d"


def _key_models(models: list[str], n: int = 3) -> str:
    if not models:
        return "—"
    head = models[:n]
    rest = len(models) - n
    s = ", ".join(head)
    return f"{s} +{rest}" if rest > 0 else s


def _ordinal(n: int) -> str:
    if 11 <= n % 100 <= 13:
        return f"{n}th"
    return f"{n}{('th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th')[n % 10]}"


def render_report(
    org_scorecard: dict,
    model_summary: list[dict],
    today: date,
    acr_month_label: str,
    manager_list_name: str,
    acr_file_name: str,
    ou_file_name: str,
) -> str:
    """Render the 9-section markdown report matching hls-csa-org-tracker.md."""
    t = org_scorecard["totals"]
    all_accounts: list[dict] = org_scorecard["allAccounts"]
    top5: list[dict] = org_scorecard["top5"]
    dir_sums: list[dict] = org_scorecard["directorSummaries"]

    L: list[str] = []

    # ── Header ──────────────────────────────────────────────────────────────
    L += [
        "# HLS CSA Org Tracker — Model Retirement Risk Report",
        "",
        f"- **Generated:** {today.isoformat()}",
        "- **Scope:** US HLS Field Accountability Unit",
        f"- **Source:** CSV org mapping ({manager_list_name})",
        f"- **ACR Source:** Power BI actual metered consumption ({acr_month_label})",
        "",
    ]

    # ── Section 1: Executive Summary ────────────────────────────────────────
    L += [
        "## 1. Executive Summary",
        "",
        "| Metric | Value |",
        "|--------|------:|",
        f"| Directors in org mapping | {t['directorsInOrg']} |",
        f"| Directors with deployed accounts | {t['directorsWithDeployments']} |",
        f"| Accounts with deployments | {t['accountsWithDeployments']} |",
        f"| Total deployments | {t['totalDeployments']:,} |",
        f"| **Total AI ACR** | **{_fmt_acr(t['totalMonthlyAcr'])}/mo** ({_fmt_fy(t['totalMonthlyAcr'])}/yr) |",
        "",
        "| Risk Level | Accounts | AI ACR at Risk |",
        "|------------|---------:|---------------:|",
        f"| ⚫ OVERDUE | {t['overdue']} | {_fmt_acr(t['overdueAcr'])}/mo |",
        f"| 🔴 CRITICAL | {t['critical']} | {_fmt_acr(t['criticalAcr'])}/mo |",
        f"| 🟡 WARNING | {t['warning']} | {_fmt_acr(t['warningAcr'])}/mo |",
        f"| 🟢 OK | {t['ok']} | — |",
        "",
        f"> **⚠️ {_fmt_acr(t['totalMonthlyAcr'])}/mo "
        f"({_fmt_fy(t['totalMonthlyAcr'])}/yr) of AI ACR is at risk** "
        f"across {t['accountsWithDeployments']} accounts.",
        "",
    ]

    # ── Section 2: Top 5 Priority Accounts ──────────────────────────────────
    L += [
        "## 2. 🏆 Top 5 Priority Accounts (by AI ACR)",
        "",
        "| Rank | Account | Director | AI ACR/mo | FY Est. | Deployments | ⚫ OD | 🔴 CR | 🟡 WN | Min Days | Risk |",
        "|:----:|---------|----------|----------:|--------:|:-----------:|:-----:|:-----:|:-----:|:--------:|:----:|",
    ]
    for i, a in enumerate(top5, 1):
        L.append(
            f"| {i} | **{a['name']}** | {', '.join(a['directors'])} | "
            f"{_fmt_acr(a['monthlyAcr'])} | {_fmt_fy(a['monthlyAcr'])} | "
            f"{a['totalDeployments']:,} | {a['overdue']} | {a['critical']} | "
            f"{a['warning']} | {_fmt_days(a['minDays'])} | {RISK_EMOJI[a['level']]} |"
        )
    L.append("")

    for i, a in enumerate(all_accounts[5:10], 6):
        L.append(
            f"### {_ordinal(i)}: {a['name']} — "
            f"{_fmt_acr(a['monthlyAcr'])}/mo | {a['totalDeployments']} deployments | "
            f"{_fmt_days(a['minDays'])} {RISK_EMOJI[a['level']]}"
        )
    L.append("")

    # ── Section 3: Director Summary ──────────────────────────────────────────
    L += [
        "## 3. Director Summary",
        "",
        "| Director | Accounts | Deployments | AI ACR/mo | ⚫ OD | 🔴 CR | 🟡 WN | Risk |",
        "|----------|:--------:|------------:|----------:|:-----:|:-----:|:-----:|:----:|",
    ]
    for ds in dir_sums:
        L.append(
            f"| {ds['director']} | {ds['accounts']} | {ds['deployments']:,} | "
            f"{_fmt_acr(ds['monthlyAcr'])} | {ds['overdue']} | {ds['critical']} | "
            f"{ds['warning']} | {RISK_EMOJI[ds['level']]} |"
        )
    L.append("")

    # ── Section 4: Models Retiring ≤180 Days ────────────────────────────────
    L += [
        "## 4. Models Retiring ≤180 Days (HLS Exposure)",
        "",
        "| Model | Retires | Days | HLS Deploys | HLS Accounts | Replacement |",
        "|-------|---------|:----:|------------:|-------------:|-------------|",
    ]
    for m in model_summary:
        L.append(
            f"| {m['model']} | {m['retirementDate']} | {m['days']}d | "
            f"{m['hlsDeploys']:,} | {m['hlsAccounts']:,} | {m['replacement']} |"
        )
    L.append("")

    # ── Appendix helper ──────────────────────────────────────────────────────
    def _appendix_table(accounts: list[dict], risk_col: str, count_fn, emoji: str) -> list[str]:
        rows: list[str] = []
        for a in accounts:
            rows.append(
                f"| **{a['name']}** | {', '.join(a['directors'])} | "
                f"{_fmt_acr(a['monthlyAcr'])} | {a['totalDeployments']:,} | "
                f"{count_fn(a)} | {_fmt_days(a['minDays'])} | "
                f"{_key_models(a['atRiskModels'])} |"
            )
        return rows

    # ── Section 5: Appendix A — Overdue ─────────────────────────────────────
    od_accts = [a for a in all_accounts if a["level"] == "overdue"]
    L += [
        f"## 5. Appendix A — ⚫ Overdue Accounts ({len(od_accts)})",
        "",
        "| Account | Director | AI ACR/mo | Deployments | ⚫ Overdue | Min Days | Key Models |",
        "|---------|----------|----------:|------------:|-----------:|:--------:|------------|",
    ]
    L += _appendix_table(od_accts, "overdue", lambda a: a["overdue"], "⚫")
    L.append("")

    # ── Section 6: Appendix B — Critical ────────────────────────────────────
    cr_accts = [a for a in all_accounts if a["level"] == "critical"]
    L += [
        f"## 6. Appendix B — 🔴 Critical Accounts ({len(cr_accts)})",
        "",
        "| Account | Director | AI ACR/mo | Deployments | 🔴 Critical | Min Days | Key Models |",
        "|---------|----------|----------:|------------:|------------:|:--------:|------------|",
    ]
    L += _appendix_table(cr_accts, "critical", lambda a: a["critical"], "🔴")
    L.append("")

    # ── Section 7: Appendix C — Warning ─────────────────────────────────────
    wn_accts = [a for a in all_accounts if a["level"] == "warning"]
    L += [
        f"## 7. Appendix C — 🟡 Warning Accounts ({len(wn_accts)})",
        "",
        "| Account | Director | AI ACR/mo | Deployments | 🟡 Warning | Min Days | Key Models |",
        "|---------|----------|----------:|------------:|-----------:|:--------:|------------|",
    ]
    L += _appendix_table(wn_accts, "warning", lambda a: a["warning"], "🟡")
    L.append("")

    # ── Section 8: Appendix D — All Accounts ────────────────────────────────
    L += [
        "## 8. Appendix D — All Accounts (ACR-Ranked)",
        "",
        "| Account | Director | AI ACR/mo | FY Est. | Deployments | Risk | ⚫ OD | 🔴 CR | 🟡 WN | Min Days |",
        "|---------|----------|----------:|--------:|:-----------:|:----:|:-----:|:-----:|:-----:|:--------:|",
    ]
    for a in all_accounts:
        L.append(
            f"| {a['name']} | {', '.join(a['directors'])} | "
            f"{_fmt_acr(a['monthlyAcr'])} | {_fmt_fy(a['monthlyAcr'])} | "
            f"{a['totalDeployments']:,} | {RISK_EMOJI[a['level']]} | "
            f"{a['overdue']} | {a['critical']} | {a['warning']} | "
            f"{_fmt_days(a['minDays'])} |"
        )
    L.append("")

    # ── Section 9: Data Sources & Notes ─────────────────────────────────────
    L += [
        "## 9. Data Sources & Notes",
        "",
        "| Source | File | Freshness |",
        "|--------|------|-----------|",
        f"| Org Mapping | {manager_list_name} | CSV input |",
        f"| Retirements | retirements.json | {today.isoformat()} |",
        f"| Customer Deployments | {ou_file_name} | CSV input |",
        f"| **AI ACR** | **{acr_file_name}** | "
        f"**Power BI actual ({acr_month_label}) — refreshed {today.isoformat()}** |",
        "",
        "### Risk Thresholds",
        "",
        "| Level | Condition |",
        "|-------|-----------|",
        "| ⚫ OVERDUE | Days remaining ≤ 0 (past retirement date) |",
        "| 🔴 CRITICAL | Days remaining ≤ 90 |",
        "| 🟡 WARNING | Days remaining ≤ 180 |",
        "| 🟢 OK | Days remaining > 180 |",
        "",
        "### Notes",
        "",
        "- **ACR figures are Power BI actual metered consumption**. "
        "This is the source of truth for revenue.",
        "- Accounts are ranked by **AI ACR first**, then risk urgency as tiebreaker.",
        f"- ACR column used: **{acr_month_label}** "
        f"(last full month as of {today.isoformat()})",
    ]

    return "\n".join(L) + "\n"


# ─── Main Entry Point ────────────────────────────────────────────────────────


def generate_org_report(
    manager_list_data: bytes,
    manager_list_name: str,
    acr_data: bytes,
    acr_name: str,
    ou_data: bytes,
    ou_name: str,
    today: date | None = None,
) -> str:
    """Orchestrate all phases and return the 9-section markdown report."""
    if today is None:
        today = date.today()

    month_col = get_last_full_month_column(today)
    ret_lookup, ret_replacements = load_retirements()

    ml_rows = load_file(manager_list_data, manager_list_name)
    org_map, account_directors = build_org_map(ml_rows)

    acr_by_name = parse_acr_data(acr_data, acr_name, month_col)

    ou_rows = load_file(ou_data, ou_name)
    deployments = parse_deployments(ou_rows)
    tpid_index = build_tpid_index(deployments)
    name_to_tpid = build_name_to_tpid(deployments)

    org_scorecard = build_org_scorecard(
        org_map, account_directors, tpid_index,
        ret_lookup, acr_by_name, name_to_tpid, today,
    )

    model_summary = build_model_fleet_summary(tpid_index, ret_lookup, ret_replacements, today)

    return render_report(
        org_scorecard, model_summary, today, month_col,
        manager_list_name, acr_name, ou_name,
    )


# ── PDF export ────────────────────────────────────────────────────────────────

_EMOJI_MAP = {
    "⚫": "[OD]", "🔴": "[CR]", "🟡": "[WN]", "🟢": "[OK]",
    "⚠️": "[!]", "🏆": "[TOP]",
    "\u2014": "-", "\u2013": "-", "\u200b": "",   # em-dash, en-dash, ZWSP
    "•": "-", "\u2022": "-",                        # bullets
    "≤": "<=", "≥": ">=",                           # math comparators
    "→": "->", "←": "<-", "↑": "^", "↓": "v",
    "\u00a0": " ",                                   # non-breaking space
    "–": "-", "—": "-",
}

_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\U00002600-\U000027BF"
    "\U0000FE00-\U0000FE0F"
    "]+",
    flags=re.UNICODE,
)


def _pdf_clean(text: str) -> str:
    for k, v in _EMOJI_MAP.items():
        text = text.replace(k, v)
    text = _EMOJI_RE.sub("", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)   # strip bold markers
    text = re.sub(r"`(.+?)`", r"\1", text)           # strip inline code
    # Drop any remaining characters outside Latin-1 to avoid fpdf font errors
    text = text.encode("latin-1", errors="ignore").decode("latin-1")
    return text.strip()


def _parse_table_row(line: str) -> list[str]:
    cells = line.strip().strip("|").split("|")
    return [_pdf_clean(c) for c in cells]


def _render_md_table(pdf, rows: list[str], usable_w: float) -> None:
    data = [_parse_table_row(r) for r in rows
            if not re.match(r"^\|[-:| ]+\|$", r)]
    if not data:
        return

    n_cols = max(len(r) for r in data)
    data = [r + [""] * (n_cols - len(r)) for r in data]

    # Weight columns by max cell length, cap at 40 chars for display
    raw_w = [max(len(row[c]) for row in data) for c in range(n_cols)]
    raw_w = [max(w, 3) for w in raw_w]
    total = sum(raw_w)
    col_w = [rw / total * usable_w for rw in raw_w]

    ROW_H = 4.5
    HDR_BG = (220, 234, 252)
    ALT_BG = (248, 251, 255)
    AZURE = (0, 120, 212)

    for ri, row in enumerate(data):
        if pdf.get_y() + ROW_H + 2 > pdf.page_break_trigger:
            pdf.add_page()

        is_hdr = ri == 0
        pdf.set_fill_color(*(HDR_BG if is_hdr else (ALT_BG if ri % 2 else (255, 255, 255))))
        pdf.set_font("Helvetica", "B" if is_hdr else "", 7)
        pdf.set_text_color(*(AZURE if is_hdr else (30, 30, 30)))

        x0 = pdf.get_x()
        y0 = pdf.get_y()
        for ci, cell in enumerate(row):
            pdf.set_xy(x0 + sum(col_w[:ci]), y0)
            pdf.cell(col_w[ci], ROW_H, cell[:36], border=1, fill=True)

        pdf.set_xy(x0, y0 + ROW_H)

    pdf.set_text_color(0, 0, 0)
    pdf.ln(2)


def build_org_report_pdf(markdown: str, generated: str = "") -> bytes:
    """Convert the org tracker markdown report to a PDF using fpdf2."""
    from fpdf import FPDF  # type: ignore[import-untyped]

    AZURE = (0, 120, 212)
    DARK = (30, 40, 54)
    MUTED = (100, 116, 139)
    MARGIN = 12
    # Landscape A4: 297 mm wide
    USABLE_W = 297 - 2 * MARGIN

    date_str = (generated[:10] if generated else str(date.today()))

    class _PDF(FPDF):
        def header(self):
            self.set_fill_color(*AZURE)
            self.rect(0, 0, 297, 3, "F")

        def footer(self):
            self.set_y(-9)
            self.set_font("Helvetica", size=6)
            self.set_text_color(*MUTED)
            self.cell(0, 4, f"HLS CSA Org Tracker  |  {date_str}  |  Page {self.page_no()}", align="C")
            self.set_text_color(0, 0, 0)

    pdf = _PDF(orientation="L", unit="mm", format="A4")
    pdf.set_margins(MARGIN, 13, MARGIN)
    pdf.set_auto_page_break(auto=True, margin=11)
    pdf.set_font("Helvetica", size=9)
    pdf.add_page()

    lines = markdown.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]

        if line.startswith("# "):
            pdf.set_font("Helvetica", "B", 15)
            pdf.set_text_color(*AZURE)
            pdf.multi_cell(0, 8, _pdf_clean(line[2:]))
            pdf.set_draw_color(*AZURE)
            pdf.line(MARGIN, pdf.get_y(), 297 - MARGIN, pdf.get_y())
            pdf.ln(3)
            pdf.set_text_color(0, 0, 0)

        elif line.startswith("## "):
            pdf.ln(4)
            pdf.set_font("Helvetica", "B", 11)
            pdf.set_text_color(*AZURE)
            pdf.multi_cell(0, 6, _pdf_clean(line[3:]))
            pdf.set_draw_color(*AZURE)
            pdf.line(MARGIN, pdf.get_y(), 297 - MARGIN, pdf.get_y())
            pdf.ln(2)
            pdf.set_text_color(0, 0, 0)

        elif line.startswith("### "):
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(*DARK)
            pdf.multi_cell(0, 5, _pdf_clean(line[4:]))
            pdf.ln(1)
            pdf.set_text_color(0, 0, 0)

        elif line.startswith("|"):
            table_rows: list[str] = []
            while i < len(lines) and lines[i].startswith("|"):
                table_rows.append(lines[i])
                i += 1
            _render_md_table(pdf, table_rows, USABLE_W)
            continue

        elif line.startswith("> "):
            pdf.set_font("Helvetica", "IB", 9)
            pdf.set_text_color(*DARK)
            pdf.set_left_margin(MARGIN + 4)
            pdf.multi_cell(0, 5, _pdf_clean(line[2:]))
            pdf.set_left_margin(MARGIN)
            pdf.ln(2)
            pdf.set_text_color(0, 0, 0)

        elif line.startswith("- ") or line.startswith("* "):
            pdf.set_font("Helvetica", size=9)
            pdf.set_text_color(*DARK)
            pdf.set_x(MARGIN + 4)
            pdf.multi_cell(0, 5, f"- {_pdf_clean(line[2:])}")

        elif line.strip() in ("---", "***", "___"):
            pdf.set_draw_color(*MUTED)
            pdf.line(MARGIN, pdf.get_y(), 297 - MARGIN, pdf.get_y())
            pdf.ln(2)

        elif not line.strip():
            pdf.ln(1.5)

        else:
            pdf.set_font("Helvetica", size=9)
            pdf.set_text_color(*DARK)
            pdf.multi_cell(0, 5, _pdf_clean(line))

        i += 1

    return bytes(pdf.output())
