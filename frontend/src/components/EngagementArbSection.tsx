import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Text,
  Badge,
  Spinner,
  Input,
  Textarea,
  Field,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { SendRegular, DocumentRegular } from "@fluentui/react-icons";
import { apiFetch } from "../config/api";
import { listSavedDesigns } from "../utils/bundledDesignStore";
import type { ArbStatus, ArbSubmission } from "../types";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { fontWeight: 600, fontSize: "13px" },
  meta: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  empty: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  list: { display: "flex", flexDirection: "column", gap: "6px" },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
    gap: "8px",
  },
  rowLeft: { display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 },
  rowTitle: { fontSize: "12px", fontWeight: 600 },
  rowMeta: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  modalForm: { display: "flex", flexDirection: "column", gap: "10px" },
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

function formatTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

interface Props {
  engagementId: string;
  onOpenSubmission?: (submissionId: string) => void;
}

export function EngagementArbSection({ engagementId, onOpenSubmission }: Props) {
  const styles = useStyles();
  const [submissions, setSubmissions] = useState<ArbSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/engagements/${engagementId}/arb/submissions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as ArbSubmission[];
      setSubmissions(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submissions");
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  function openModal() {
    const latest = listSavedDesigns()[0];
    setDraftTitle(latest?.bundle.workload_name ?? "");
    setDraftSummary("");
    setSubmitError(null);
    setModalOpen(true);
  }

  async function submitDraft() {
    const title = draftTitle.trim();
    if (!title) {
      setSubmitError("Title is required");
      return;
    }
    const latest = listSavedDesigns()[0];
    if (!latest) {
      setSubmitError("No bundled design available — run a pipeline first.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const citations =
        (latest.bundle as { citations?: unknown[] }).citations ?? [];
      const res = await apiFetch(`/api/engagements/${engagementId}/arb/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary: draftSummary.trim() || undefined,
          bundled_design_snapshot: latest.bundle,
          citation_snapshot: citations,
          conditions: [],
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }
      setModalOpen(false);
      await fetchSubmissions();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <Text className={styles.title}>ARB submissions</Text>
          <div className={styles.meta}>
            {loading ? "Loading…" : `${submissions.length} submission(s)`}
          </div>
        </div>
        <Button
          size="small"
          appearance="primary"
          icon={<SendRegular />}
          onClick={openModal}
          disabled={loading}
        >
          Submit current design
        </Button>
      </div>

      {error && <Text className={styles.warn}>{error}</Text>}

      {submissions.length === 0 ? (
        <Text className={styles.empty}>
          No ARB submissions yet. Submit a bundled design to freeze it for reviewer sign-off.
        </Text>
      ) : (
        <div className={styles.list}>
          {submissions.map((s) => (
            <div key={s.id} className={styles.row}>
              <div className={styles.rowLeft}>
                <Text className={styles.rowTitle}>{s.title}</Text>
                <Text className={styles.rowMeta}>
                  Submitted {formatTime(s.submitted_at)}
                  {s.submitted_by ? ` by ${s.submitted_by}` : ""}
                </Text>
              </div>
              <Badge size="small" appearance="filled" color={STATUS_COLOR[s.status] ?? "subtle"}>
                {s.status.replace(/_/g, " ")}
              </Badge>
              {onOpenSubmission && (
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<DocumentRegular />}
                  onClick={() => onOpenSubmission(s.id)}
                >
                  Open
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={(_, d) => setModalOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Submit design for ARB</DialogTitle>
            <DialogContent>
              <div className={styles.modalForm}>
                <Field label="Title" required>
                  <Input
                    value={draftTitle}
                    onChange={(_, d) => setDraftTitle(d.value)}
                    placeholder="e.g. AKS baseline v2 — prod readiness"
                  />
                </Field>
                <Field label="Summary" hint="1–2 sentences for reviewers">
                  <Textarea
                    value={draftSummary}
                    rows={3}
                    onChange={(_, d) => setDraftSummary(d.value)}
                  />
                </Field>
                {submitError && <Text className={styles.warn}>{submitError}</Text>}
                <Text className={styles.meta}>
                  Snapshot will freeze the most recent bundled design and its citations.
                </Text>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setModalOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                icon={submitting ? <Spinner size="tiny" /> : <SendRegular />}
                onClick={submitDraft}
                disabled={submitting}
              >
                {submitting ? "Submitting…" : "Submit"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
