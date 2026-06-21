import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Text,
  Badge,
  Spinner,
  Input,
  Textarea,
  Field,
  TabList,
  Tab,
  MessageBar,
  MessageBarBody,
  Divider,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  CheckmarkRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { apiFetch, apiPath } from "../config/api";
import type {
  ArbCondition,
  ArbConditionStatus,
  ArbStatus,
  ArbSubmission,
  Citation,
} from "../types";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" },
  headerLeft: { display: "flex", flexDirection: "column", gap: "4px" },
  title: { fontWeight: 600, fontSize: "16px" },
  meta: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  section: { display: "flex", flexDirection: "column", gap: "8px" },
  snapshot: {
    fontSize: "12px",
    fontFamily: tokens.fontFamilyMonospace,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
    padding: "8px",
    maxHeight: "320px",
    overflow: "auto",
    whiteSpace: "pre-wrap",
  },
  citationRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
    gap: "8px",
  },
  citationLeft: { display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 },
  conditionRow: {
    display: "flex",
    flexDirection: "column",
    padding: "8px 10px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
    gap: "6px",
  },
  conditionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" },
  conditionActions: { display: "flex", gap: "6px", flexWrap: "wrap" },
  inlineForm: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" },
  decisionForm: { display: "flex", flexDirection: "column", gap: "8px" },
  warn: { fontSize: "11px", color: tokens.colorPaletteRedForeground1 },
});

const STATUS_COLOR: Record<ArbStatus, "informative" | "warning" | "success" | "danger" | "subtle"> = {
  draft: "subtle",
  submitted: "informative",
  in_review: "warning",
  approved: "success",
  approved_with_conditions: "success",
  rejected: "danger",
  withdrawn: "subtle",
};

const CONDITION_STATUS_COLOR: Record<
  ArbConditionStatus,
  "informative" | "warning" | "success" | "subtle"
> = {
  open: "warning",
  in_progress: "informative",
  cleared: "success",
  waived: "subtle",
};

const ALL_TARGET_STATUSES: ArbStatus[] = [
  "submitted",
  "in_review",
  "approved",
  "approved_with_conditions",
  "rejected",
  "withdrawn",
];

const TERMINAL_STATUSES: Set<ArbStatus> = new Set(["approved", "rejected"]);
const REQUIRES_SUMMARY: Set<ArbStatus> = new Set([
  "approved",
  "approved_with_conditions",
  "rejected",
]);

function formatTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

type TabKey = "design" | "citations" | "conditions" | "decisions";

interface Props {
  submissionId: string;
  onClose?: () => void;
}

export function ArbSubmissionView({ submissionId, onClose }: Props) {
  const styles = useStyles();
  const [submission, setSubmission] = useState<ArbSubmission | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("design");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchSubmission = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/arb/submissions/${submissionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as ArbSubmission;
      setSubmission(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submission");
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    fetchSubmission();
  }, [fetchSubmission]);

  if (loading && !submission) {
    return <Spinner size="small" label="Loading submission…" />;
  }
  if (error) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>{error}</MessageBarBody>
      </MessageBar>
    );
  }
  if (!submission) return null;

  const conditions = submission.conditions ?? [];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Text className={styles.title}>{submission.title}</Text>
          <Text className={styles.meta}>
            Submitted {formatTime(submission.submitted_at)}
            {submission.submitted_by ? ` by ${submission.submitted_by}` : ""}
          </Text>
          <div>
            <Badge size="small" appearance="filled" color={STATUS_COLOR[submission.status]}>
              {submission.status.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>
        {onClose && (
          <Button size="small" appearance="subtle" icon={<DismissRegular />} onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      {actionError && (
        <MessageBar intent="error">
          <MessageBarBody>{actionError}</MessageBarBody>
        </MessageBar>
      )}

      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as TabKey)}>
        <Tab value="design">Design snapshot</Tab>
        <Tab value="citations">Citations ({submission.citation_snapshot?.length ?? 0})</Tab>
        <Tab value="conditions">Conditions ({conditions.length})</Tab>
        <Tab value="decisions">Decisions</Tab>
      </TabList>

      {tab === "design" && (
        <DesignSnapshotTab submission={submission} styles={styles} />
      )}

      {tab === "citations" && (
        <CitationsTab citations={submission.citation_snapshot ?? []} styles={styles} />
      )}

      {tab === "conditions" && (
        <ConditionsTab
          conditions={conditions}
          styles={styles}
          busy={busy}
          setBusy={setBusy}
          setActionError={setActionError}
          onChanged={fetchSubmission}
        />
      )}

      {tab === "decisions" && (
        <DecisionsTab
          submission={submission}
          styles={styles}
          busy={busy}
          setBusy={setBusy}
          setActionError={setActionError}
          onChanged={fetchSubmission}
        />
      )}
    </div>
  );
}

// ── Design snapshot ──────────────────────────────────────────────────────────

function DesignSnapshotTab({
  submission,
  styles,
}: {
  submission: ArbSubmission;
  styles: ReturnType<typeof useStyles>;
}) {
  const packetUrl = apiPath(`/api/arb/submissions/${submission.id}/packet.pdf`);
  const snapshot = useMemo(
    () => JSON.stringify(submission.bundled_design_snapshot, null, 2),
    [submission.bundled_design_snapshot],
  );
  return (
    <div className={styles.section}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          size="small"
          appearance="primary"
          icon={<ArrowDownloadRegular />}
          as="a"
          href={packetUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Download packet (PDF)
        </Button>
      </div>
      <pre className={styles.snapshot}>{snapshot}</pre>
    </div>
  );
}

// ── Citations ────────────────────────────────────────────────────────────────

function CitationsTab({
  citations,
  styles,
}: {
  citations: Citation[];
  styles: ReturnType<typeof useStyles>;
}) {
  if (citations.length === 0) {
    return <Text className={styles.meta}>No citations were frozen with this submission.</Text>;
  }
  return (
    <div className={styles.section}>
      {citations.map((c, i) => (
        <div key={`${c.url}-${i}`} className={styles.citationRow}>
          <div className={styles.citationLeft}>
            <Text style={{ fontSize: "12px", fontWeight: 600 }}>{c.title}</Text>
            <Text className={styles.meta}>
              {[c.corpus, c.published_at, c.freshness_days != null ? `${c.freshness_days}d` : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </div>
          {c.url && (
            <Button
              size="small"
              appearance="subtle"
              as="a"
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Conditions ───────────────────────────────────────────────────────────────

function ConditionsTab({
  conditions,
  styles,
  busy,
  setBusy,
  setActionError,
  onChanged,
}: {
  conditions: ArbCondition[];
  styles: ReturnType<typeof useStyles>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setActionError: (v: string | null) => void;
  onChanged: () => Promise<void> | void;
}) {
  if (conditions.length === 0) {
    return <Text className={styles.meta}>No approval conditions on this submission.</Text>;
  }
  return (
    <div className={styles.section}>
      {conditions.map((c) => (
        <ConditionRow
          key={c.id}
          condition={c}
          styles={styles}
          busy={busy}
          setBusy={setBusy}
          setActionError={setActionError}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function ConditionRow({
  condition,
  styles,
  busy,
  setBusy,
  setActionError,
  onChanged,
}: {
  condition: ArbCondition;
  styles: ReturnType<typeof useStyles>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setActionError: (v: string | null) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"none" | "clear" | "waive">("none");
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [rationale, setRationale] = useState("");

  const terminal = condition.status === "cleared" || condition.status === "waived";

  async function submit() {
    const body: Record<string, string> = {};
    if (mode === "clear") {
      if (!evidence.trim()) {
        setActionError("Evidence URL is required to clear a condition.");
        return;
      }
      body.status = "cleared";
      body.evidence_url = evidence.trim();
      if (notes.trim()) body.notes = notes.trim();
    } else if (mode === "waive") {
      if (!rationale.trim()) {
        setActionError("Rationale is required to waive a condition.");
        return;
      }
      body.status = "waived";
      body.notes = rationale.trim();
    } else {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/arb/conditions/${condition.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      setMode("none");
      setEvidence("");
      setNotes("");
      setRationale("");
      await onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.conditionRow}>
      <div className={styles.conditionHeader}>
        <Text style={{ fontSize: "12px", fontWeight: 600 }}>{condition.text}</Text>
        <Badge size="small" appearance="outline">
          {condition.severity}
        </Badge>
        <Badge size="small" color={CONDITION_STATUS_COLOR[condition.status]}>
          {condition.status.replace(/_/g, " ")}
        </Badge>
      </div>
      {(condition.owner || condition.evidence_url || condition.notes) && (
        <Text className={styles.meta}>
          {[
            condition.owner ? `owner: ${condition.owner}` : null,
            condition.evidence_url ? `evidence: ${condition.evidence_url}` : null,
            condition.notes,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      )}
      {!terminal && (
        <div className={styles.conditionActions}>
          <Button
            size="small"
            appearance={mode === "clear" ? "primary" : "secondary"}
            icon={<CheckmarkRegular />}
            disabled={busy}
            onClick={() => setMode(mode === "clear" ? "none" : "clear")}
          >
            Clear
          </Button>
          <Button
            size="small"
            appearance={mode === "waive" ? "primary" : "secondary"}
            disabled={busy}
            onClick={() => setMode(mode === "waive" ? "none" : "waive")}
          >
            Waive
          </Button>
        </div>
      )}
      {mode === "clear" && (
        <div className={styles.inlineForm}>
          <Field label="Evidence URL" required>
            <Input value={evidence} onChange={(_, d) => setEvidence(d.value)} />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(_, d) => setNotes(d.value)} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="small" appearance="primary" disabled={busy} onClick={submit}>
              {busy ? "Saving…" : "Confirm clear"}
            </Button>
          </div>
        </div>
      )}
      {mode === "waive" && (
        <div className={styles.inlineForm}>
          <Field label="Rationale" required hint="Why is the residual risk acceptable?">
            <Textarea rows={3} value={rationale} onChange={(_, d) => setRationale(d.value)} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="small" appearance="primary" disabled={busy} onClick={submit}>
              {busy ? "Saving…" : "Confirm waive"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Decisions ────────────────────────────────────────────────────────────────

function DecisionsTab({
  submission,
  styles,
  busy,
  setBusy,
  setActionError,
  onChanged,
}: {
  submission: ArbSubmission;
  styles: ReturnType<typeof useStyles>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setActionError: (v: string | null) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [target, setTarget] = useState<ArbStatus | "">("");
  const [summary, setSummary] = useState("");

  const isTerminal = TERMINAL_STATUSES.has(submission.status);

  async function submit() {
    if (!target) {
      setActionError("Pick a target status.");
      return;
    }
    if (REQUIRES_SUMMARY.has(target) && !summary.trim()) {
      setActionError("Decision summary is required for this transition.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const body: Record<string, string> = { status: target };
      if (summary.trim()) body.decision_summary = summary.trim();
      const res = await apiFetch(`/api/arb/submissions/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        throw new Error("Transition not allowed from current status.");
      }
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      setTarget("");
      setSummary("");
      await onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Transition failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.decisionForm}>
      {submission.decision_summary && (
        <div className={styles.section}>
          <Text style={{ fontSize: "12px", fontWeight: 600 }}>Last decision</Text>
          <Text className={styles.meta}>
            {formatTime(submission.decided_at)}
            {submission.decided_by ? ` · ${submission.decided_by}` : ""}
          </Text>
          <Text style={{ fontSize: "12px" }}>{submission.decision_summary}</Text>
          <Divider />
        </div>
      )}
      {isTerminal ? (
        <Text className={styles.meta}>
          This submission is in a terminal status ({submission.status.replace(/_/g, " ")}) and
          cannot transition further.
        </Text>
      ) : (
        <>
          <Field label="Target status" required>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as ArbStatus | "")}
              style={{
                padding: "6px 8px",
                border: `1px solid ${tokens.colorNeutralStroke2}`,
                borderRadius: "4px",
                fontSize: "12px",
              }}
            >
              <option value="">— pick —</option>
              {ALL_TARGET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Decision summary"
            hint="Required for approved / approved_with_conditions / rejected"
          >
            <Textarea
              rows={3}
              value={summary}
              onChange={(_, d) => setSummary(d.value)}
            />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              size="small"
              appearance="primary"
              disabled={busy || !target}
              onClick={submit}
            >
              {busy ? "Saving…" : "Apply transition"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
