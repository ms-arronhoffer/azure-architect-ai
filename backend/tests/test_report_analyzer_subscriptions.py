"""Tests for subscription-scoped ACR in report_analyzer_service.

The reported (impacted) ACR for an account should reflect only the Azure
subscriptions that appear in the OU deployment inventory (Account Details), and
those subscriptions should be surfaced per account for the recommendations
report. When the OU export carries no subscription column, behaviour falls back
to the account-level ACR total.
"""

from datetime import date, timedelta

from services.report_analyzer_service import (
    _recommendations_appendix,
    build_manager_name_to_tpid,
    build_org_scorecard,
    build_tpid_subscription_models,
    build_tpid_subscriptions,
    parse_acr_subscriptions,
)


def _acr_subs_csv(*data_rows: str, sub_header: str = "SubscriptionName") -> bytes:
    header = "FiscalMonth,,FY26-May,FY26-Jun,Total\n"
    label = f"TPAccountName,{sub_header},$ ACR,$ ACR,$ ACR\n"
    return (header + label + "".join(r + "\n" for r in data_rows)).encode()


# ── parse_acr_subscriptions ──────────────────────────────────────────────────


def test_parse_acr_subscriptions_forward_fills_account_and_splits_by_subscription():
    csv = _acr_subs_csv(
        'City of Hope,Total,"$60","$66","$126"',
        ',AccessHope Azure Subscription,"$5","$6","$11"',
        ',DEV Applied AI,"$50","$60","$110"',
    )
    subs = parse_acr_subscriptions(csv, "acr.csv", ["FY26-Jun", "FY26-May"])
    assert subs == {
        "CITY OF HOPE": {
            "ACCESSHOPE AZURE SUBSCRIPTION": 6.0,
            "DEV APPLIED AI": 60.0,
        }
    }


def test_parse_acr_subscriptions_returns_empty_without_grouping_column():
    csv = (
        b"FiscalMonth,FY26-May,FY26-Jun,Total\n"
        b"TPAccountName,$ ACR,$ ACR,$ ACR\n"
        b'City of Hope,"$5,000","$6,000","$11,000"\n'
    )
    assert parse_acr_subscriptions(csv, "acr.csv", ["FY26-Jun"]) == {}


def test_parse_acr_subscriptions_falls_back_to_earlier_month_when_latest_empty():
    csv = _acr_subs_csv(
        'City of Hope,Total,"$60","$0","$60"',
        ',AccessHope Azure Subscription,"$5","$0","$5"',
        ',DEV Applied AI,"$55","$0","$55"',
    )
    subs = parse_acr_subscriptions(csv, "acr.csv", ["FY26-Jun", "FY26-May"])
    assert subs == {
        "CITY OF HOPE": {
            "ACCESSHOPE AZURE SUBSCRIPTION": 5.0,
            "DEV APPLIED AI": 55.0,
        }
    }


# ── build_tpid_subscriptions ─────────────────────────────────────────────────


def test_build_tpid_subscriptions_detects_column_and_groups_by_tpid():
    deps = [
        {"_tpid": "42", "SubscriptionName": "AccessHope Azure Subscription"},
        {"_tpid": "42", "SubscriptionName": "DEV Applied AI"},
        {"_tpid": "42", "SubscriptionName": "AccessHope Azure Subscription"},
    ]
    assert build_tpid_subscriptions(deps) == {
        "42": {
            "ACCESSHOPE AZURE SUBSCRIPTION": "AccessHope Azure Subscription",
            "DEV APPLIED AI": "DEV Applied AI",
        }
    }


def test_build_tpid_subscriptions_handles_alternate_header_spellings():
    deps = [{"_tpid": "7", "Subscription Id": "Prod-01"}]
    assert build_tpid_subscriptions(deps) == {"7": {"PROD-01": "Prod-01"}}


def test_build_tpid_subscriptions_empty_when_no_subscription_column():
    deps = [{"_tpid": "42", "Model": "gpt-4"}]
    assert build_tpid_subscriptions(deps) == {}


# ── build_org_scorecard: subscription-scoped ACR ─────────────────────────────


def _scorecard(acr_by_name, org_map, tpid_index, acr_subs=None, tpid_subs=None, sub_models=None):
    name_to_tpid = build_manager_name_to_tpid(org_map)
    account_directors = {
        a["tpid"]: ["Dir"]
        for accts in org_map.values()
        for a in accts["accounts"]
    }
    return build_org_scorecard(
        org_map=org_map,
        account_directors=account_directors,
        tpid_index=tpid_index,
        ret_lookup={},
        acr_by_name=acr_by_name,
        name_to_tpid=name_to_tpid,
        today=date(2026, 7, 13),
        acr_subs_by_name=acr_subs,
        tpid_subscriptions=tpid_subs,
        tpid_subscription_models=sub_models,
    )


def test_impacted_acr_restricted_to_ou_subscriptions():
    org_map = {"Dir": {"accounts": [{"tpid": "42", "name": "City of Hope"}]}}
    tpid_index = {"42": [{"_tpid": "42", "Model": "gpt-4"}]}
    # Account total ACR is $126, but only two subscriptions are deployed.
    acr_by_name = {"CITY OF HOPE": 126.0}
    acr_subs = {
        "CITY OF HOPE": {
            "ACCESSHOPE AZURE SUBSCRIPTION": 6.0,
            "DEV APPLIED AI": 60.0,
            "SOME OTHER SUBSCRIPTION": 60.0,  # not in OU deployments
        }
    }
    tpid_subs = {
        "42": {
            "ACCESSHOPE AZURE SUBSCRIPTION": "AccessHope Azure Subscription",
            "DEV APPLIED AI": "DEV Applied AI",
        }
    }

    sc = _scorecard(acr_by_name, org_map, tpid_index, acr_subs, tpid_subs)
    acct = sc["allAccounts"][0]
    # Impacted ACR = only the two OU-deployed subscriptions ($6 + $60).
    assert acct["monthlyAcr"] == 66.0
    assert acct["accountTotalAcr"] == 126.0
    assert acct["subscriptionScope"] == "impacted"
    matched = {s["name"]: s["monthlyAcr"] for s in acct["impactedSubscriptions"]}
    assert matched == {
        "DEV Applied AI": 60.0,
        "AccessHope Azure Subscription": 6.0,
    }
    # Impacted ACR drives org totals.
    assert sc["totals"]["totalMonthlyAcr"] == 66.0


def test_unmatched_subscriptions_fall_back_to_account_total():
    # OU lists subscriptions but none match the ACR breakdown → keep the total
    # rather than silently reporting $0.
    org_map = {"Dir": {"accounts": [{"tpid": "42", "name": "City of Hope"}]}}
    tpid_index = {"42": [{"_tpid": "42", "Model": "gpt-4"}]}
    acr_by_name = {"CITY OF HOPE": 126.0}
    acr_subs = {"CITY OF HOPE": {"SUBSCRIPTION A": 126.0}}
    tpid_subs = {"42": {"SUBSCRIPTION Z": "Subscription Z"}}

    sc = _scorecard(acr_by_name, org_map, tpid_index, acr_subs, tpid_subs)
    acct = sc["allAccounts"][0]
    assert acct["monthlyAcr"] == 126.0
    assert acct["accountTotalAcr"] == 126.0
    assert acct["subscriptionScope"] == "unmatched"


def test_no_subscription_data_keeps_account_total():
    # No OU subscription column at all → classic account-total behaviour.
    org_map = {"Dir": {"accounts": [{"tpid": "42", "name": "City of Hope"}]}}
    tpid_index = {"42": [{"_tpid": "42", "Model": "gpt-4"}]}
    acr_by_name = {"CITY OF HOPE": 126.0}

    sc = _scorecard(acr_by_name, org_map, tpid_index, acr_subs=None, tpid_subs=None)
    acct = sc["allAccounts"][0]
    assert acct["monthlyAcr"] == 126.0
    assert acct["subscriptionScope"] == "all"
    assert acct["impactedSubscriptions"] == []


# ── build_tpid_subscription_models ───────────────────────────────────────────


def _ret_lookup_soon(today: date) -> dict:
    # A retirement 30 days out → "critical" for classify_risk.
    return {"gpt-4.1": today + timedelta(days=30)}


def test_build_tpid_subscription_models_groups_at_risk_models_by_subscription():
    today = date(2026, 7, 13)
    deps = [
        {"_tpid": "42", "SubscriptionName": "PBC-CDA-PROD", "Model": "gpt-4.1"},
        {"_tpid": "42", "SubscriptionName": "PBC-CDA-PROD", "Model": "gpt-4.1-mini"},
        {"_tpid": "42", "SubscriptionName": "PBC-AISE-PROD", "Model": "gpt-4.1"},
        # Not at risk (no retirement) → excluded.
        {"_tpid": "42", "SubscriptionName": "PBC-CORE-PROD", "Model": "gpt-4o"},
    ]
    ret = {
        "gpt-4.1": today + timedelta(days=30),
        "gpt-4.1-mini": today + timedelta(days=30),
    }
    result = build_tpid_subscription_models(deps, ret, today)
    assert result == {
        "42": {
            "PBC-CDA-PROD": ["gpt-4.1", "gpt-4.1-mini"],
            "PBC-AISE-PROD": ["gpt-4.1"],
        }
    }


def test_build_tpid_subscription_models_empty_without_subscription_column():
    today = date(2026, 7, 13)
    deps = [{"_tpid": "42", "Model": "gpt-4.1"}]
    assert build_tpid_subscription_models(deps, _ret_lookup_soon(today), today) == {}


# ── impacted subscriptions carry models ──────────────────────────────────────


def test_impacted_subscriptions_carry_at_risk_models():
    org_map = {"Dir": {"accounts": [{"tpid": "42", "name": "PREMERA BLUE CROSS"}]}}
    tpid_index = {"42": [{"_tpid": "42", "Model": "gpt-4.1"}]}
    acr_by_name = {"PREMERA BLUE CROSS": 30_000.0}
    acr_subs = {
        "PREMERA BLUE CROSS": {
            "PBC-CDA-PROD": 16_994.0,
            "PBC-AISE-PROD": 12_692.0,
        }
    }
    tpid_subs = {
        "42": {
            "PBC-CDA-PROD": "PBC-CDA-PROD",
            "PBC-AISE-PROD": "PBC-AISE-PROD",
        }
    }
    sub_models = {
        "42": {
            "PBC-CDA-PROD": ["gpt-4.1", "gpt-4.1-mini"],
            "PBC-AISE-PROD": ["gpt-4.1"],
        }
    }

    sc = _scorecard(acr_by_name, org_map, tpid_index, acr_subs, tpid_subs, sub_models)
    acct = sc["allAccounts"][0]
    by_name = {s["name"]: s for s in acct["impactedSubscriptions"]}
    assert by_name["PBC-CDA-PROD"]["models"] == ["gpt-4.1", "gpt-4.1-mini"]
    assert by_name["PBC-AISE-PROD"]["models"] == ["gpt-4.1"]


# ── recommendations appendix ─────────────────────────────────────────────────


def test_recommendations_appendix_expands_every_subscription():
    org_scorecard = {
        "allAccounts": [
            {
                "name": "PREMERA BLUE CROSS",
                "monthlyAcr": 30_000.0,
                "accountTotalAcr": 33_780.0,
                "directors": ["Archana"],
                "subscriptionScope": "impacted",
                "impactedSubscriptions": [
                    {"name": "PBC-CDA-PROD", "monthlyAcr": 16_994.0, "matched": True,
                     "models": ["gpt-4.1", "gpt-4.1-mini"]},
                    {"name": "PBC-AISE-PROD", "monthlyAcr": 12_692.0, "matched": True,
                     "models": ["gpt-4.1"]},
                    {"name": "PBC-CORE-PROD", "monthlyAcr": 1_314.0, "matched": True,
                     "models": ["gpt-4.1-nano"]},
                    {"name": "UNMATCHED", "monthlyAcr": 0.0, "matched": False, "models": []},
                ],
            }
        ]
    }
    md = _recommendations_appendix(org_scorecard, date(2026, 7, 13))
    assert "Appendix" in md
    assert "PREMERA BLUE CROSS" in md
    # All matched subscriptions appear (nothing hidden behind "+N more").
    assert "PBC-CDA-PROD" in md
    assert "PBC-AISE-PROD" in md
    assert "PBC-CORE-PROD" in md
    # Per-subscription models and revenue are shown.
    assert "gpt-4.1-mini" in md
    assert "$16,994" in md
    # Unmatched subscriptions are excluded.
    assert "UNMATCHED" not in md


def test_recommendations_appendix_empty_when_no_scoped_accounts():
    org_scorecard = {
        "allAccounts": [
            {"name": "A", "monthlyAcr": 10.0, "subscriptionScope": "all",
             "impactedSubscriptions": []},
        ]
    }
    assert _recommendations_appendix(org_scorecard, date(2026, 7, 13)) == ""
