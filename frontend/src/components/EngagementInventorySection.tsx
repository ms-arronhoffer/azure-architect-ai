import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Text,
  Badge,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowSyncRegular } from "@fluentui/react-icons";
import { apiFetch } from "../config/api";

interface InventoryResponse {
  engagement_id: string;
  total_documents: number;
  by_fact_kind: Record<string, number>;
  by_resource_type: Record<string, number>;
  last_synced_at: string | null;
}

interface ScanEvent {
  type: string;
  engagement_id?: string;
  subscriptions?: number;
  docs_indexed?: number;
  errors?: string[];
  reason?: string;
  error?: string;
}

const FACT_KIND_LABELS: Record<string, string> = {
  resource: "Resources",
  public_ip: "Public IPs",
  open_nsg_rule: "Open NSG rules",
  policy_noncompliance: "Policy findings",
  cost_mtd: "Cost snapshots",
  advisor_recommendation: "Advisor recs",
};

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { fontWeight: 600, fontSize: "13px" },
  meta: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  empty: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  countsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "6px",
  },
  countCell: {
    display: "flex",
    flexDirection: "column",
    padding: "6px 8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
  },
  countLabel: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  countValue: { fontSize: "14px", fontWeight: 600 },
  topTypes: { display: "flex", flexWrap: "wrap", gap: "4px" },
  progressLine: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
  },
});

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const deltaSec = Math.max(0, (Date.now() - then) / 1000);
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

export function EngagementInventorySection({ engagementId }: { engagementId: string }) {
  const styles = useStyles();
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/engagements/${engagementId}/inventory`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as InventoryResponse;
      setInventory(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    fetchInventory();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchInventory]);

  async function rescan() {
    if (scanning) return;
    setScanning(true);
    setProgress("Starting scan…");
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await apiFetch(`/api/engagements/${engagementId}/scan`, {
        method: "POST",
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Scan failed: HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: ScanEvent;
          try {
            event = JSON.parse(line.slice(6)) as ScanEvent;
          } catch {
            continue;
          }
          if (event.type === "scan_started") {
            setProgress(`Scanning ${event.subscriptions ?? 0} subscription(s)…`);
          } else if (event.type === "scan_complete") {
            const indexed = event.docs_indexed ?? 0;
            const errCount = event.errors?.length ?? 0;
            setProgress(
              errCount
                ? `Indexed ${indexed} document(s); ${errCount} warning(s)`
                : `Indexed ${indexed} document(s)`,
            );
          } else if (event.type === "scan_failed") {
            setError(event.error ?? "Scan failed");
          } else if (event.type === "scan_skipped") {
            setProgress(`Skipped: ${event.reason ?? "no subscriptions"}`);
          }
        }
      }
      await fetchInventory();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Scan failed");
      }
    } finally {
      setScanning(false);
      abortRef.current = null;
      setTimeout(() => setProgress(null), 4000);
    }
  }

  const topResourceTypes = inventory
    ? Object.entries(inventory.by_resource_type).slice(0, 6)
    : [];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <Text className={styles.title}>Live inventory</Text>
          <div className={styles.meta}>
            Last synced {formatRelativeTime(inventory?.last_synced_at ?? null)}
          </div>
        </div>
        <Button
          size="small"
          appearance="secondary"
          icon={scanning ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
          disabled={scanning || loading}
          onClick={rescan}
        >
          {scanning ? "Scanning…" : "Re-scan now"}
        </Button>
      </div>

      {error && (
        <Text style={{ fontSize: "11px", color: tokens.colorPaletteRedForeground1 }}>
          {error}
        </Text>
      )}

      {progress && <div className={styles.progressLine}>{progress}</div>}

      {!inventory || inventory.total_documents === 0 ? (
        <Text className={styles.empty}>
          No inventory yet. Add subscription IDs above and re-scan to snapshot Azure resources,
          policy findings, and MTD cost into this engagement's private RAG corpus.
        </Text>
      ) : (
        <>
          <div className={styles.countsGrid}>
            {Object.entries(inventory.by_fact_kind).map(([kind, count]) => (
              <div key={kind} className={styles.countCell}>
                <span className={styles.countLabel}>
                  {FACT_KIND_LABELS[kind] ?? kind}
                </span>
                <span className={styles.countValue}>{count}</span>
              </div>
            ))}
          </div>
          {topResourceTypes.length > 0 && (
            <div>
              <div className={styles.meta} style={{ marginBottom: "4px" }}>
                Top resource types
              </div>
              <div className={styles.topTypes}>
                {topResourceTypes.map(([type, count]) => (
                  <Badge key={type} appearance="outline" size="small">
                    {type} ×{count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
