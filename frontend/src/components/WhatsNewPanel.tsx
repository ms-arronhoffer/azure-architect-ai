import { useState, useEffect, useCallback } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  Input,
  Checkbox,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Textarea,
} from "@fluentui/react-components";
import {
  MegaphoneLoudRegular,
  MailRegular,
  ArrowClockwiseRegular,
  SearchRegular,
  OpenRegular,
  CopyRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import type { Announcement } from "../types";

const SOURCE_FILTERS = [
  { value: "all", label: "All Sources" },
  { value: "azure-blog", label: "Azure Blog" },
  { value: "azure-updates", label: "Azure Updates" },
  { value: "azure-sdk", label: "Azure SDK Blog" },
  { value: "azure-devblogs", label: "Azure DevBlogs" },
  { value: "fabric-updates", label: "Microsoft Fabric Updates" },
  { value: "powerbi-updates", label: "Power BI Updates" },
];

const TIME_FILTERS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All Time" },
];

const SOURCE_COLORS: Record<string, string> = {
  "azure-blog": "#0078D4",
  "azure-updates": "#00B7C3",
  "azure-sdk": "#008272",
  "azure-devblogs": "#5C2D91",
  "fabric-updates": "#742774",
  "powerbi-updates": "#F2C811",
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
    color: "#0078D4",
    filter: "drop-shadow(0 0 8px rgba(0,120,212,0.5))",
  },
  title: {
    fontSize: "18px",
    fontWeight: 700,
    background: "var(--gradient-azure)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    lineHeight: 1.2,
    marginBottom: "2px",
  },
  subtitle: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground4,
  },
  filterBar: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px 28px",
    background: tokens.colorNeutralBackground1,
    borderBottom: "1px solid var(--glass-border)",
    flexShrink: 0,
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap",
  },
  sourceFilters: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  timeFilters: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  filterPill: {
    padding: "4px 12px",
    borderRadius: "20px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "transparent",
    color: tokens.colorNeutralForeground3,
    fontSize: "12px",
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: "inherit",
    "&:hover": {
      background: "rgba(0,120,212,0.1)",
      border: "1px solid rgba(0,120,212,0.4)",
      color: tokens.colorNeutralForeground1,
    },
  },
  filterPillActive: {
    background: "rgba(0,120,212,0.15)",
    border: "1px solid #0078D4",
    color: "#50A6E8",
    fontWeight: 600,
  },
  searchInput: {
    minWidth: "220px",
  },
  content: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 28px",
    paddingBottom: "80px",
  },
  centered: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "60px 0",
    color: tokens.colorNeutralForeground3,
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "14px",
  },
  card: {
    background: "var(--glass-bg)",
    border: "1px solid var(--glass-border)",
    borderRadius: "10px",
    padding: "16px",
    cursor: "pointer",
    transition: "all 0.15s",
    boxShadow: "var(--glass-shadow)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    "&:hover": {
      background: "var(--glass-bg-hover)",
      border: "1px solid var(--glass-border-hover)",
      boxShadow: "var(--glass-shadow-hover)",
      transform: "translateY(-1px)",
    },
  },
  cardSelected: {
    background: "rgba(0,120,212,0.12)",
    border: "1px solid #0078D4",
    boxShadow: "0 4px 24px rgba(0,120,212,0.22), inset 0 0 0 1px rgba(0,120,212,0.3)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "10px",
  },
  sourceBadge: {
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "10px",
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "0.02em",
    flexShrink: 0,
  },
  cardDate: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
    flex: 1,
  },
  cardCheckbox: {
    flexShrink: 0,
  },
  cardTitle: {
    display: "flex",
    alignItems: "flex-start",
    gap: "6px",
    fontSize: "13px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    textDecoration: "none",
    lineHeight: 1.4,
    marginBottom: "8px",
    "&:hover": {
      color: "#50A6E8",
    },
  },
  externalIcon: {
    fontSize: "12px",
    flexShrink: 0,
    marginTop: "2px",
    color: tokens.colorNeutralForeground4,
  },
  cardDescription: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: "3",
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 28px",
    background: "var(--glass-bg)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    borderTop: "1px solid var(--glass-border)",
    boxShadow: "0 -4px 24px rgba(0,0,0,0.3)",
    zIndex: 5,
  },
  actionBarCount: {
    flex: 1,
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
  },
  dialogSurface: {
    width: "min(640px, 95vw)",
    maxHeight: "85vh",
  },
  dialogContent: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    paddingTop: "4px",
  },
  selectedList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    maxHeight: "120px",
    overflowY: "auto",
    padding: "8px",
    background: tokens.colorNeutralBackground3,
    borderRadius: "6px",
    border: "1px solid var(--glass-border)",
  },
  selectedItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  sourceBadgeSmall: {
    padding: "1px 6px",
    borderRadius: "3px",
    fontSize: "9px",
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
  },
  draftResult: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  draftField: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  draftActions: {
    display: "flex",
    justifyContent: "flex-end",
  },
  htmlPreview: {
    width: "100%",
    height: "320px",
    border: "1px solid var(--glass-border)",
    borderRadius: "6px",
    background: "#ffffff",
  },
});

function formatRelativeDate(pubDate: string): string {
  if (!pubDate) return "";
  try {
    const date = new Date(pubDate);
    if (isNaN(date.getTime())) return pubDate.slice(0, 10);
    const diffMs = Date.now() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return pubDate.slice(0, 10);
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export default function WhatsNewPanel() {
  const styles = useStyles();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("30");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [customerContext, setCustomerContext] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whats-new${forceRefresh ? "?refresh=true" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAnnouncements(data.announcements ?? []);
      setLastRefreshed(new Date());
    } catch {
      setError("Failed to load announcements. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const cutoff = timeFilter !== "all" ? Date.now() - parseInt(timeFilter) * 86400_000 : null;

  const filtered = announcements
    .filter((a) => {
      const matchesSource = sourceFilter === "all" || a.source === sourceFilter;
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q || a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
      const matchesTime = cutoff === null || new Date(a.pub_date).getTime() >= cutoff;
      return matchesSource && matchesSearch && matchesTime;
    })
    .sort((a, b) => new Date(b.pub_date).getTime() - new Date(a.pub_date).getTime());

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openDialog() {
    setDraftSubject("");
    setDraftBody("");
    setCustomerContext("");
    setEmailDialogOpen(true);
  }

  async function handleDraftEmail() {
    setDraftLoading(true);
    setDraftSubject("");
    setDraftBody("");
    try {
      const res = await fetch("/api/whats-new/draft-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          announcement_ids: Array.from(selected),
          customer_context: customerContext,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDraftSubject(data.subject ?? "");
      setDraftBody(data.body ?? "");
    } catch {
      setDraftBody("Failed to generate email draft. Please try again.");
    } finally {
      setDraftLoading(false);
    }
  }

  function openOutlook() {
    const plainBody = stripHtml(draftBody);
    const maxBodyLen = 1800;
    const body = plainBody.length > maxBodyLen
      ? plainBody.slice(0, maxBodyLen) + "\n\n[Email truncated — paste full version from clipboard]"
      : plainBody;
    const url = `mailto:?subject=${encodeURIComponent(draftSubject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([draftBody], { type: "text/html" }),
          "text/plain": new Blob([stripHtml(draftBody)], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(stripHtml(draftBody));
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const selectedAnnouncements = announcements.filter((a) => selected.has(a.id));

  return (
    <div className={styles.root} style={{ position: "relative" }}>
      {/* Panel header */}
      <div className={styles.panelHeader}>
        <div className={styles.headerLeft}>
          <MegaphoneLoudRegular className={styles.headerIcon} />
          <div>
            <div className={styles.title}>What's New for Azure Architects</div>
            {lastRefreshed && (
              <Text className={styles.subtitle}>
                Updated {lastRefreshed.toLocaleTimeString()}
              </Text>
            )}
          </div>
        </div>
        <Button
          appearance="subtle"
          icon={<ArrowClockwiseRegular />}
          onClick={() => fetchData(true)}
          disabled={loading}
          size="small"
        >
          Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <div className={styles.filterRow}>
          <div className={styles.sourceFilters}>
            {SOURCE_FILTERS.map((f) => (
              <button
                key={f.value}
                className={`${styles.filterPill} ${sourceFilter === f.value ? styles.filterPillActive : ""}`}
                onClick={() => setSourceFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Input
            className={styles.searchInput}
            placeholder="Search announcements…"
            contentBefore={<SearchRegular />}
            value={searchQuery}
            onChange={(_, d) => setSearchQuery(d.value)}
            size="small"
          />
        </div>
        <div className={styles.timeFilters}>
          {TIME_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`${styles.filterPill} ${timeFilter === f.value ? styles.filterPillActive : ""}`}
              onClick={() => setTimeFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {loading && (
          <div className={styles.centered}>
            <Spinner label="Loading announcements from Microsoft feeds…" />
          </div>
        )}
        {error && !loading && (
          <div className={styles.centered}>
            <Text className={styles.errorText}>{error}</Text>
            <Button onClick={() => fetchData()} appearance="subtle">Try Again</Button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className={styles.centered}>
            <Text>No announcements match your filters.</Text>
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className={styles.grid}>
            {filtered.map((a) => (
              <div
                key={a.id}
                className={`${styles.card} ${selected.has(a.id) ? styles.cardSelected : ""}`}
                onClick={() => toggleSelect(a.id)}
              >
                <div className={styles.cardHeader}>
                  <span
                    className={styles.sourceBadge}
                    style={{ background: SOURCE_COLORS[a.source] ?? "#0078D4" }}
                  >
                    {a.source_label}
                  </span>
                  <span className={styles.cardDate}>{formatRelativeDate(a.pub_date)}</span>
                  <Checkbox
                    checked={selected.has(a.id)}
                    onChange={() => toggleSelect(a.id)}
                    onClick={(e) => e.stopPropagation()}
                    className={styles.cardCheckbox}
                  />
                </div>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.cardTitle}
                  onClick={(e) => e.stopPropagation()}
                >
                  {a.title}
                  <OpenRegular className={styles.externalIcon} />
                </a>
                <Text className={styles.cardDescription}>{a.description}</Text>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky action bar — shown when items are selected */}
      {selected.size > 0 && (
        <div className={styles.actionBar}>
          <Text className={styles.actionBarCount}>
            {selected.size} announcement{selected.size !== 1 ? "s" : ""} selected
          </Text>
          <Button
            appearance="subtle"
            size="small"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </Button>
          <Button
            appearance="primary"
            icon={<MailRegular />}
            onClick={openDialog}
          >
            Draft Customer Email
          </Button>
        </div>
      )}

      {/* Email draft dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={(_, d) => setEmailDialogOpen(d.open)}>
        <DialogSurface className={styles.dialogSurface}>
          <DialogBody>
            <DialogTitle
              action={
                <Button
                  appearance="subtle"
                  aria-label="Close"
                  icon={<DismissRegular />}
                  onClick={() => setEmailDialogOpen(false)}
                />
              }
            >
              Draft Customer Email
            </DialogTitle>
            <DialogContent>
              <div className={styles.dialogContent}>
                <div>
                  <Text weight="semibold" size={200}>
                    Selected Announcements ({selected.size})
                  </Text>
                  <div className={styles.selectedList}>
                    {selectedAnnouncements.map((a) => (
                      <div key={a.id} className={styles.selectedItem}>
                        <span
                          className={styles.sourceBadgeSmall}
                          style={{ background: SOURCE_COLORS[a.source] ?? "#0078D4" }}
                        >
                          {a.source_label}
                        </span>
                        <Text size={200}>{a.title}</Text>
                      </div>
                    ))}
                  </div>
                </div>

                <Textarea
                  placeholder="Optional: Describe your customer (industry, current workloads, specific interests)…"
                  value={customerContext}
                  onChange={(_, d) => setCustomerContext(d.value)}
                  rows={3}
                  resize="vertical"
                  style={{ width: "100%" }}
                />

                {!draftBody && !draftLoading && (
                  <Button
                    appearance="primary"
                    icon={<MailRegular />}
                    onClick={handleDraftEmail}
                    style={{ alignSelf: "flex-start" }}
                  >
                    Generate Draft
                  </Button>
                )}

                {draftLoading && <Spinner label="Drafting customer email…" size="small" />}

                {draftBody && !draftLoading && (
                  <div className={styles.draftResult}>
                    <div className={styles.draftField}>
                      <Text weight="semibold" size={200}>Subject</Text>
                      <Input
                        value={draftSubject}
                        onChange={(_, d) => setDraftSubject(d.value)}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div className={styles.draftField}>
                      <Text weight="semibold" size={200}>Email Body Preview</Text>
                      <iframe
                        srcDoc={draftBody}
                        className={styles.htmlPreview}
                        sandbox="allow-same-origin"
                        title="Email preview"
                      />
                    </div>
                    <div className={styles.draftActions}>
                      <Button
                        appearance="subtle"
                        icon={<ArrowClockwiseRegular />}
                        onClick={handleDraftEmail}
                        size="small"
                      >
                        Regenerate
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
            {draftBody && !draftLoading && (
              <DialogActions>
                <Button
                  appearance="subtle"
                  icon={<CopyRegular />}
                  onClick={copyToClipboard}
                >
                  {copied ? "Copied!" : "Copy to Clipboard"}
                </Button>
                <Button
                  appearance="primary"
                  icon={<MailRegular />}
                  onClick={openOutlook}
                >
                  Open in Outlook
                </Button>
              </DialogActions>
            )}
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
