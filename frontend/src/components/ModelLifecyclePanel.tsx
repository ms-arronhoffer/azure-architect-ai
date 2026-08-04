import { useCallback, useEffect, useMemo, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Button,
  Input,
  Spinner,
  MessageBar,
  Tab,
  TabList,
  Link,
} from "@fluentui/react-components";
import {
  CalendarRegular,
  OpenRegular,
  SearchRegular,
  ArrowDownloadRegular,
  ArrowClockwiseRegular,
} from "@fluentui/react-icons";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { apiFetch } from "../config/api";

type Lifecycle = "GA" | "Preview" | "Deprecated" | "Retired" | "Legacy";
type FilterTab = "soon" | "atrisk" | "retired" | "all";

interface ModelEntry {
  provider: string;
  model: string;
  version: string;
  lifecycle: Lifecycle;
  retirement: string | null;
  replacement: string | null;
  soldBy: "Azure" | "Partner";
}

interface LifecycleResponse {
  models: ModelEntry[];
  count: number;
  last_refreshed: string | null;
  source_url: string;
  stale: boolean;
}

const LEARN_URL = "https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule";
const SOON_DAYS = 90;

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

const lifecycleBadgeColor: Record<Lifecycle, "success" | "informative" | "warning" | "danger" | "subtle"> = {
  GA: "success",
  Preview: "informative",
  Deprecated: "warning",
  Retired: "danger",
  Legacy: "subtle",
};

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    background: tokens.colorNeutralBackground2,
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 28px 16px",
    background: "var(--glass-bg)",
    borderBottom: "1px solid var(--glass-border)",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  headerIcon: {
    fontSize: "28px",
    color: "#8764B8",
    filter: "drop-shadow(0 0 8px rgba(135,100,184,0.5))",
  },
  title: {
    fontSize: "18px",
    fontWeight: 700,
    color: tokens.colorNeutralForeground1,
    lineHeight: 1.2,
    marginBottom: "6px",
  },
  subtitle: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  controls: {
    padding: "12px 28px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    flexShrink: 0,
  },
  controlsRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap",
  },
  searchBox: {
    width: "220px",
    flexShrink: 0,
  },
  countBadge: {
    marginLeft: "auto",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  tableWrap: {
    flex: 1,
    overflowY: "auto",
    padding: "0 28px 24px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: "12px",
    fontSize: "13px",
  },
  thead: {
    position: "sticky",
    top: 0,
    background: tokens.colorNeutralBackground2,
    zIndex: 1,
  },
  th: {
    padding: "8px 10px",
    textAlign: "left",
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: tokens.colorNeutralForeground3,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    ":hover": {
      background: "rgba(255,255,255,0.03)",
    },
  },
  td: {
    padding: "7px 10px",
    verticalAlign: "middle",
    color: tokens.colorNeutralForeground1,
  },
  modelName: {
    fontFamily: "monospace",
    fontSize: "12px",
    fontWeight: 500,
  },
  version: {
    fontFamily: "monospace",
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
  },
  retireSoon: {
    color: "#E87C2B",
    fontWeight: 600,
  },
  retireVerySOon: {
    color: "#C50F1F",
    fontWeight: 700,
  },
  retirePast: {
    color: tokens.colorNeutralForeground4,
  },
  retireNormal: {
    color: tokens.colorNeutralForeground2,
  },
  soldByChip: {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: "3px",
    fontSize: "10px",
    fontWeight: 600,
    background: "rgba(0,120,212,0.15)",
    color: "#5BA8F5",
  },
  soldByPartner: {
    background: "rgba(135,100,184,0.15)",
    color: "#B19CD9",
  },
  noResults: {
    textAlign: "center",
    padding: "48px 0",
    color: tokens.colorNeutralForeground3,
  },
  providerChips: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  providerLabel: {
    fontSize: "11px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginRight: "2px",
    flexShrink: 0,
  },
});

const FILTER_LABEL: Record<FilterTab, string> = {
  soon: "Retiring Within 90 Days",
  atrisk: "Deprecated or Legacy",
  retired: "Retired",
  all: "All Models",
};

const COLUMNS = ["Provider", "Model", "Version", "Lifecycle", "Retirement Date", "Replacement", "Sold By"] as const;

function modelToRow(m: ModelEntry): string[] {
  return [m.provider, m.model, m.version, m.lifecycle, m.retirement ?? "—", m.replacement ?? "—", m.soldBy];
}

function exportToXlsx(models: ModelEntry[], filterLabel: string) {
  const generated = new Date().toISOString().slice(0, 10);
  const rows = [
    ["Azure AI Model Lifecycle Report"],
    [`Filter: ${filterLabel}`],
    [`Generated: ${generated}  ·  Source: Microsoft Learn Azure Foundry model retirement schedule`],
    [],
    [...COLUMNS],
    ...models.map(modelToRow),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [20, 34, 14, 12, 16, 30, 10].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Model Lifecycle");
  XLSX.writeFile(wb, `azure-model-lifecycle-${generated}.xlsx`);
}

function exportToPdf(models: ModelEntry[], filterLabel: string) {
  const generated = new Date().toISOString().slice(0, 10);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.setTextColor(0, 78, 140);
  doc.text("Azure AI Model Lifecycle Report", 14, 16);

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Filter: ${filterLabel}`, 14, 23);
  doc.text(`Generated: ${generated}  ·  Source: Microsoft Learn Azure Foundry model retirement schedule`, 14, 28);

  autoTable(doc, {
    startY: 33,
    head: [COLUMNS as unknown as string[]],
    body: models.map(modelToRow),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [0, 78, 140], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 248, 252] },
    columnStyles: { 1: { cellWidth: 50 }, 5: { cellWidth: 42 } },
  });

  const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width - 20, doc.internal.pageSize.height - 6);
  }

  doc.save(`azure-model-lifecycle-${generated}.pdf`);
}

export default function ModelLifecyclePanel() {
  const styles = useStyles();
  const [filter, setFilter] = useState<FilterTab>("soon");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The schedule is refreshed server-side at most once a day from Microsoft
  // Learn, so every user sees the same current data without a client cache.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("/api/model-migration/lifecycle");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: LifecycleResponse = await r.json();
      setModels(data.models ?? []);
      setLastRefreshed(data.last_refreshed ?? null);
      setStale(Boolean(data.stale));
    } catch {
      setError("Could not load the retirement schedule. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const providers = useMemo(
    () => [...new Set(models.map((m) => m.provider))].sort(),
    [models],
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    const q = search.toLowerCase();

    return models.filter((m) => {
      const retMs = m.retirement ? new Date(m.retirement).getTime() : null;
      const days = retMs !== null ? Math.ceil((retMs - now) / (24 * 60 * 60 * 1000)) : null;

      const matchesSearch = !q ||
        m.model.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (m.replacement ?? "").toLowerCase().includes(q);

      if (!matchesSearch) return false;
      if (providerFilter && m.provider !== providerFilter) return false;

      switch (filter) {
        case "soon":
          return retMs !== null && days! <= SOON_DAYS;
        case "atrisk":
          return m.lifecycle === "Deprecated" || m.lifecycle === "Legacy";
        case "retired":
          return m.lifecycle === "Retired";
        case "all":
          return true;
      }
    }).sort((a, b) => {
      if (!a.retirement && !b.retirement) return 0;
      if (!a.retirement) return 1;
      if (!b.retirement) return -1;
      return new Date(a.retirement).getTime() - new Date(b.retirement).getTime();
    });
  }, [models, filter, search, providerFilter]);

  function retirementCell(retirement: string | null) {
    if (!retirement) return <span className={styles.retireNormal}>—</span>;
    const days = daysUntil(retirement);
    if (days < 0) return <span className={styles.retirePast}>{retirement} (past)</span>;
    if (days <= 30) return <span className={styles.retireVerySOon}>{retirement} ({days}d)</span>;
    if (days <= SOON_DAYS) return <span className={styles.retireSoon}>{retirement} ({days}d)</span>;
    return <span className={styles.retireNormal}>{retirement}</span>;
  }

  const soonCount = useMemo(() => models.filter(m => {
    if (!m.retirement) return false;
    return daysUntil(m.retirement) <= SOON_DAYS;
  }).length, [models]);

  const atRiskCount = models.filter(m => m.lifecycle === "Deprecated" || m.lifecycle === "Legacy").length;
  const retiredCount = models.filter(m => m.lifecycle === "Retired").length;

  return (
    <div className={styles.root}>
      <div className={styles.panelHeader}>
        <div className={styles.headerLeft}>
          <CalendarRegular className={styles.headerIcon} />
          <div>
            <Text className={styles.title}>AI Model Lifecycle</Text>
            <Text className={styles.subtitle}>
              Azure Foundry model retirement schedule · {models.length} models tracked
              {lastRefreshed && ` · updated ${new Date(lastRefreshed).toLocaleDateString()}`}
            </Text>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowClockwiseRegular />}
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh
          </Button>
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowDownloadRegular />}
            onClick={() => exportToXlsx(filtered, FILTER_LABEL[filter])}
          >
            Export XLSX
          </Button>
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowDownloadRegular />}
            onClick={() => exportToPdf(filtered, FILTER_LABEL[filter])}
          >
            Export PDF
          </Button>
          <Link href={LEARN_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
            Microsoft Learn <OpenRegular style={{ fontSize: "14px" }} />
          </Link>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.controlsRow}>
          <TabList
            selectedValue={filter}
            onTabSelect={(_, d) => setFilter(d.value as FilterTab)}
            size="small"
          >
            <Tab value="soon">Retiring ≤90 days <Badge size="small" shape="rounded" color="warning" style={{ marginLeft: "4px" }}>{soonCount}</Badge></Tab>
            <Tab value="atrisk">Deprecated / Legacy <Badge size="small" shape="rounded" color="subtle" style={{ marginLeft: "4px" }}>{atRiskCount}</Badge></Tab>
            <Tab value="retired">Retired <Badge size="small" shape="rounded" color="danger" style={{ marginLeft: "4px" }}>{retiredCount}</Badge></Tab>
            <Tab value="all">All ({models.length})</Tab>
          </TabList>
          <Input
            className={styles.searchBox}
            contentBefore={<SearchRegular />}
            placeholder="Filter by model or provider…"
            value={search}
            onChange={(_, d) => setSearch(d.value)}
            size="small"
          />
          <Text className={styles.countBadge}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</Text>
        </div>
        <div className={styles.providerChips}>
          <Text className={styles.providerLabel}>Provider</Text>
          <Badge
            size="small"
            shape="rounded"
            appearance={providerFilter === null ? "filled" : "outline"}
            color={providerFilter === null ? "brand" : "subtle"}
            style={{ cursor: "pointer", userSelect: "none" }}
            onClick={() => setProviderFilter(null)}
          >
            All
          </Badge>
          {providers.map((p) => (
            <Badge
              key={p}
              size="small"
              shape="rounded"
              appearance={providerFilter === p ? "filled" : "outline"}
              color={providerFilter === p ? "brand" : "subtle"}
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => setProviderFilter(providerFilter === p ? null : p)}
            >
              {p}
            </Badge>
          ))}
        </div>
      </div>

      <div className={styles.tableWrap}>
        {error && (
          <MessageBar intent="error" style={{ marginTop: "12px" }}>{error}</MessageBar>
        )}
        {!error && stale && models.length > 0 && (
          <MessageBar intent="warning" style={{ marginTop: "12px" }}>
            Showing the last known schedule — the live Microsoft Learn source could not be reached.
          </MessageBar>
        )}
        {loading && models.length === 0 ? (
          <div className={styles.noResults}>
            <Spinner size="small" label="Loading retirement schedule…" />
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.noResults}>
            <Text>No models match the current filter.</Text>
          </div>
        ) : (
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Provider</th>
                <th className={styles.th}>Model</th>
                <th className={styles.th}>Version</th>
                <th className={styles.th}>Lifecycle</th>
                <th className={styles.th}>Retirement Date</th>
                <th className={styles.th}>Replacement</th>
                <th className={styles.th}>Sold By</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr key={i} className={styles.tr}>
                  <td className={styles.td}>{m.provider}</td>
                  <td className={styles.td}><span className={styles.modelName}>{m.model}</span></td>
                  <td className={styles.td}><span className={styles.version}>{m.version}</span></td>
                  <td className={styles.td}>
                    <Badge size="small" shape="rounded" color={lifecycleBadgeColor[m.lifecycle] ?? "subtle"}>
                      {m.lifecycle}
                    </Badge>
                  </td>
                  <td className={styles.td}>{retirementCell(m.retirement)}</td>
                  <td className={styles.td} style={{ fontSize: "12px", color: tokens.colorNeutralForeground3 }}>
                    {m.replacement ?? "—"}
                  </td>
                  <td className={styles.td}>
                    <span className={`${styles.soldByChip} ${m.soldBy === "Partner" ? styles.soldByPartner : ""}`}>
                      {m.soldBy === "Azure" ? "Azure" : "Partner"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
