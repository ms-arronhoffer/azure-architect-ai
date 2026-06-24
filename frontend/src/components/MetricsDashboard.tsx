import { useCallback, useEffect, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Spinner,
  Button,
  MessageBar,
  MessageBarBody,
  Card,
  CardHeader,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from "@fluentui/react-components";
import { ArrowSyncRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { apiFetch } from "../config/api";

interface ModeCount {
  mode: string;
  count: number;
}

interface DauRow {
  day: number;
  users: number;
  conversations: number;
}

interface TopUser {
  user_id: string;
  count: number;
}

interface TokenByModel {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
}

interface TokenByUser {
  user_id: string;
  prompt_tokens: number;
  completion_tokens: number;
}

interface TokenByMode {
  mode: string;
  prompt_tokens: number;
  completion_tokens: number;
}

interface OutputByMode {
  mode: string;
  total: number;
  output_rate_pct: number;
}

interface MetricsResponse {
  // totals
  total_conversations: number;
  unique_users: number;
  active_today: number;
  weekly_active: number;
  avg_duration_min: number;
  output_rate_pct: number;
  wow_pct: number;
  conversations_30d: number;
  conversations_today: number;
  // engagement
  avg_msgs_per_conv: number;
  abandonment_rate_pct: number;
  stickiness_pct: number;
  // retention
  new_users_7d: number;
  return_rate_7d: number;
  // feature adoption
  mode_diversity: number;
  output_rate_by_mode: OutputByMode[];
  // token consumption
  total_tokens_30d: number;
  total_prompt_tokens_30d: number;
  total_completion_tokens_30d: number;
  avg_tokens_per_conv: number;
  // tables
  mode_breakdown: ModeCount[];
  dau_30d: DauRow[];
  top_users: TopUser[];
  token_by_model: TokenByModel[];
  token_by_user: TokenByUser[];
  token_by_mode: TokenByMode[];
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    padding: "24px",
    overflowY: "auto",
    overflowX: "hidden",
    flex: 1,
    minHeight: 0,
    boxSizing: "border-box",
  },
  sectionLabel: {
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: tokens.colorNeutralForeground4,
    marginBottom: "-8px",
  },
  heroRow: {
    display: "flex",
    gap: "16px",
    flexWrap: "wrap",
  },
  heroCard: {
    flex: "1 1 140px",
    minWidth: "120px",
    padding: "16px 20px",
  },
  heroValue: {
    fontSize: "28px",
    fontWeight: 700,
    color: tokens.colorBrandForeground1,
    lineHeight: 1.1,
  },
  heroValuePositive: {
    fontSize: "28px",
    fontWeight: 700,
    color: tokens.colorPaletteGreenForeground1,
    lineHeight: 1.1,
  },
  heroValueNegative: {
    fontSize: "28px",
    fontWeight: 700,
    color: tokens.colorStatusDangerForeground1,
    lineHeight: 1.1,
  },
  heroLabel: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginTop: "4px",
  },
  heroSubtext: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
    marginTop: "2px",
  },
  tables: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
  },
  tableCard: {
    padding: "0",
  },
  tableTitle: {
    padding: "14px 16px 10px",
    fontWeight: 600,
    fontSize: "14px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  tableWrap: {
    maxHeight: "320px",
    overflowY: "auto",
  },
  pct: {
    color: tokens.colorNeutralForeground3,
    fontSize: "12px",
  },
  rateBar: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  rateBarFill: {
    height: "6px",
    borderRadius: "3px",
    background: tokens.colorBrandBackground,
    minWidth: "2px",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  toolbarSpacer: {
    flex: 1,
  },
});

/** Compact human-readable token/number formatting (e.g. 1.2M, 14.5K). */
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function wowLabel(pct: number): string {
  if (pct === 0) return "—";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** Build a shareable PDF report of the current KPI snapshot. */
function exportToPdf(data: MetricsResponse): void {
  const generated = new Date().toLocaleString();
  const stamp = new Date().toISOString().slice(0, 10);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const accent: [number, number, number] = [0, 78, 140];
  const pageWidth = doc.internal.pageSize.width;

  doc.setFontSize(18);
  doc.setTextColor(...accent);
  doc.text("Azure Architect AI — Usage Report", 14, 18);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Generated: ${generated}  ·  Window: last 30 days`, 14, 24);

  const kpis: [string, string][] = [
    ["Total Conversations", data.total_conversations.toLocaleString()],
    ["Conversations (30d)", data.conversations_30d.toLocaleString()],
    ["Conversations Today", data.conversations_today.toLocaleString()],
    ["Unique Users", data.unique_users.toLocaleString()],
    ["Active Today", data.active_today.toLocaleString()],
    ["Weekly Active Users", data.weekly_active.toLocaleString()],
    ["Week-over-Week Growth", wowLabel(data.wow_pct)],
    ["Avg Session Duration", data.avg_duration_min > 0 ? `${data.avg_duration_min} min` : "—"],
    ["Avg Messages / Conv", data.avg_msgs_per_conv > 0 ? String(data.avg_msgs_per_conv) : "—"],
    ["Short Session Rate", `${data.abandonment_rate_pct}%`],
    ["Output Generated Rate", `${data.output_rate_pct}%`],
    ["Stickiness (DAU/WAU)", `${data.stickiness_pct}%`],
    ["7-Day Return Rate", data.return_rate_7d > 0 ? `${data.return_rate_7d}%` : "—"],
    ["New Users (7d)", data.new_users_7d.toLocaleString()],
    ["Avg Modes per User", String(data.mode_diversity)],
    ["Total Tokens (30d)", data.total_tokens_30d.toLocaleString()],
    ["Input Tokens (30d)", data.total_prompt_tokens_30d.toLocaleString()],
    ["Output Tokens (30d)", data.total_completion_tokens_30d.toLocaleString()],
    ["Avg Tokens / Conv", data.avg_tokens_per_conv.toLocaleString()],
  ];

  autoTable(doc, {
    startY: 30,
    head: [["KPI", "Value"]],
    body: kpis,
    theme: "striped",
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 248, 252] },
    columnStyles: { 1: { halign: "right", cellWidth: 50 } },
  });

  type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY: number } };
  const sectionTable = (
    title: string,
    head: string[],
    body: (string | number)[][],
  ): void => {
    if (!body.length) return;
    const prevY = (doc as AutoTableDoc).lastAutoTable?.finalY ?? 30;
    let startY = prevY + 10;
    if (startY > doc.internal.pageSize.height - 30) {
      doc.addPage();
      startY = 18;
    }
    doc.setFontSize(12);
    doc.setTextColor(...accent);
    doc.text(title, 14, startY);
    autoTable(doc, {
      startY: startY + 3,
      head: [head],
      body: body.map((row) => row.map((c) => (typeof c === "number" ? c.toLocaleString() : c))),
      theme: "striped",
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 248, 252] },
    });
  };

  sectionTable(
    "Token Usage by Mode (30d)",
    ["Mode", "Input", "Output", "Total"],
    data.token_by_mode.map((r) => [r.mode, r.prompt_tokens, r.completion_tokens, r.prompt_tokens + r.completion_tokens]),
  );
  sectionTable(
    "Token Usage by Model (30d)",
    ["Model", "Input", "Output", "Total"],
    data.token_by_model.map((r) => [r.model, r.prompt_tokens, r.completion_tokens, r.prompt_tokens + r.completion_tokens]),
  );
  sectionTable(
    "Mode Usage",
    ["Mode", "Conversations", "Share"],
    data.mode_breakdown.map((r) => [
      r.mode,
      r.count,
      `${Math.round((r.count / (data.total_conversations || 1)) * 100)}%`,
    ]),
  );

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 28, doc.internal.pageSize.height - 6);
  }

  doc.save(`azure-usage-report-${stamp}.pdf`);
}

export default function MetricsDashboard() {
  const styles = useStyles();
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch("/api/admin/metrics")
      .then(async (r) => {
        if (!r.ok) {
          const t = await r.text().catch(() => r.statusText);
          throw new Error(`${r.status}: ${t}`);
        }
        return r.json() as Promise<MetricsResponse>;
      })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className={styles.root} style={{ alignItems: "center", justifyContent: "center" }}>
        <Spinner label="Loading metrics…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.root}>
        <MessageBar intent="error">
          <MessageBarBody>Failed to load metrics: {error}</MessageBarBody>
        </MessageBar>
        <Button appearance="outline" icon={<ArrowSyncRegular />} onClick={load} style={{ alignSelf: "flex-start" }}>Retry</Button>
      </div>
    );
  }

  if (!data) return null;

  const total = data.total_conversations || 1;
  const wowPositive = data.wow_pct > 0;
  const wowNegative = data.wow_pct < 0;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Text size={500} weight="semibold">Usage Metrics</Text>
        <div className={styles.toolbarSpacer} />
        <Button
          appearance="subtle"
          size="small"
          icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
          onClick={load}
          disabled={loading}
          title="Refresh metrics"
        >
          Refresh
        </Button>
        <Button
          appearance="primary"
          size="small"
          icon={<ArrowDownloadRegular />}
          onClick={() => exportToPdf(data)}
          title="Export KPIs as a PDF report"
        >
          Export PDF
        </Button>
      </div>

      {/* ── Volume ── */}
      <div>
        <div className={styles.sectionLabel}>Volume</div>
        <div className={styles.heroRow} style={{ marginTop: "12px" }}>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.total_conversations.toLocaleString()}</div>
            <div className={styles.heroLabel}>Total Conversations</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.conversations_30d.toLocaleString()}</div>
            <div className={styles.heroLabel}>Conversations (30d)</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.conversations_today.toLocaleString()}</div>
            <div className={styles.heroLabel}>Conversations Today</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.unique_users.toLocaleString()}</div>
            <div className={styles.heroLabel}>Unique Users</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.active_today.toLocaleString()}</div>
            <div className={styles.heroLabel}>Active Today</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.weekly_active.toLocaleString()}</div>
            <div className={styles.heroLabel}>Weekly Active Users</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={wowPositive ? styles.heroValuePositive : wowNegative ? styles.heroValueNegative : styles.heroValue}>
              {wowLabel(data.wow_pct)}
            </div>
            <div className={styles.heroLabel}>Week-over-Week Growth</div>
          </Card>
        </div>
      </div>

      {/* ── Engagement ── */}
      <div>
        <div className={styles.sectionLabel}>Engagement</div>
        <div className={styles.heroRow} style={{ marginTop: "12px" }}>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.avg_duration_min > 0 ? `${data.avg_duration_min}m` : "—"}</div>
            <div className={styles.heroLabel}>Avg Session Duration</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.avg_msgs_per_conv > 0 ? data.avg_msgs_per_conv : "—"}</div>
            <div className={styles.heroLabel}>Avg Messages / Conv</div>
            <div className={styles.heroSubtext}>higher = deeper engagement</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={data.abandonment_rate_pct > 50 ? styles.heroValueNegative : styles.heroValue}>
              {data.abandonment_rate_pct}%
            </div>
            <div className={styles.heroLabel}>Short Session Rate</div>
            <div className={styles.heroSubtext}>≤ 1 user turn</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.output_rate_pct}%</div>
            <div className={styles.heroLabel}>Output Generated Rate</div>
            <div className={styles.heroSubtext}>conversations with structured result</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.stickiness_pct}%</div>
            <div className={styles.heroLabel}>Stickiness (DAU/WAU)</div>
            <div className={styles.heroSubtext}>{"≥ 20% is strong for tools"}</div>
          </Card>
        </div>
      </div>

      {/* ── Retention ── */}
      <div>
        <div className={styles.sectionLabel}>Retention</div>
        <div className={styles.heroRow} style={{ marginTop: "12px" }}>
          <Card className={styles.heroCard}>
            <div className={data.return_rate_7d >= 40 ? styles.heroValuePositive : styles.heroValue}>
              {data.return_rate_7d > 0 ? `${data.return_rate_7d}%` : "—"}
            </div>
            <div className={styles.heroLabel}>7-Day Return Rate</div>
            <div className={styles.heroSubtext}>prior-week users who came back</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.new_users_7d.toLocaleString()}</div>
            <div className={styles.heroLabel}>New Users (7 days)</div>
            <div className={styles.heroSubtext}>first conversation this week</div>
          </Card>
        </div>
      </div>

      {/* ── Feature Adoption ── */}
      <div>
        <div className={styles.sectionLabel}>Feature Adoption</div>
        <div className={styles.heroRow} style={{ marginTop: "12px" }}>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{data.mode_diversity}</div>
            <div className={styles.heroLabel}>Avg Modes per User</div>
            <div className={styles.heroSubtext}>breadth of feature usage</div>
          </Card>
        </div>
      </div>

      {/* ── Token Consumption ── */}
      <div>
        <div className={styles.sectionLabel}>Token Consumption (30 days)</div>
        <div className={styles.heroRow} style={{ marginTop: "12px" }}>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{fmtCompact(data.total_tokens_30d)}</div>
            <div className={styles.heroLabel}>Total Tokens</div>
            <div className={styles.heroSubtext}>all features, all users</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{fmtCompact(data.total_prompt_tokens_30d)}</div>
            <div className={styles.heroLabel}>Input Tokens</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{fmtCompact(data.total_completion_tokens_30d)}</div>
            <div className={styles.heroLabel}>Output Tokens</div>
          </Card>
          <Card className={styles.heroCard}>
            <div className={styles.heroValue}>{fmtCompact(data.avg_tokens_per_conv)}</div>
            <div className={styles.heroLabel}>Avg Tokens / Conv</div>
            <div className={styles.heroSubtext}>token intensity per conversation</div>
          </Card>
        </div>
      </div>

      {/* ── Tables ── */}
      <div className={styles.tables}>
        <Card className={styles.tableCard}>
          <CardHeader header={<Text className={styles.tableTitle}>Mode Usage</Text>} />
          <div className={styles.tableWrap}>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Mode</TableHeaderCell>
                  <TableHeaderCell>Conversations</TableHeaderCell>
                  <TableHeaderCell>Share</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.mode_breakdown.map((row) => (
                  <TableRow key={row.mode}>
                    <TableCell>{row.mode}</TableCell>
                    <TableCell>{row.count.toLocaleString()}</TableCell>
                    <TableCell>
                      <span className={styles.pct}>{Math.round((row.count / total) * 100)}%</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className={styles.tableCard}>
          <CardHeader header={<Text className={styles.tableTitle}>Output Rate by Mode</Text>} />
          <div className={styles.tableWrap}>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Mode</TableHeaderCell>
                  <TableHeaderCell>Conversations</TableHeaderCell>
                  <TableHeaderCell>Output Rate</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.output_rate_by_mode.map((row) => (
                  <TableRow key={row.mode}>
                    <TableCell>{row.mode}</TableCell>
                    <TableCell>{row.total.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className={styles.rateBar}>
                        <div
                          className={styles.rateBarFill}
                          style={{ width: `${Math.max(row.output_rate_pct, 2)}px` }}
                        />
                        <span className={styles.pct}>{row.output_rate_pct}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className={styles.tableCard}>
          <CardHeader header={<Text className={styles.tableTitle}>Daily Activity (30 days)</Text>} />
          <div className={styles.tableWrap}>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Users</TableHeaderCell>
                  <TableHeaderCell>Conversations</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dau_30d.slice().reverse().map((row) => (
                  <TableRow key={row.day}>
                    <TableCell>{dayLabel(row.day)}</TableCell>
                    <TableCell>{row.users}</TableCell>
                    <TableCell>{row.conversations}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className={styles.tableCard}>
          <CardHeader header={<Text className={styles.tableTitle}>Top Users (last 30 days)</Text>} />
          <div className={styles.tableWrap}>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>User ID</TableHeaderCell>
                  <TableHeaderCell>Conversations</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.top_users.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell>
                      <Text style={{ fontSize: "11px", fontFamily: "monospace" }}>
                        {row.user_id.length > 20 ? `${row.user_id.slice(0, 20)}…` : row.user_id}
                      </Text>
                    </TableCell>
                    <TableCell>{row.count.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className={styles.tableCard}>
          <CardHeader header={<Text className={styles.tableTitle}>Token Usage by Mode (30 days)</Text>} />
          <div className={styles.tableWrap}>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Mode</TableHeaderCell>
                  <TableHeaderCell>Input</TableHeaderCell>
                  <TableHeaderCell>Output</TableHeaderCell>
                  <TableHeaderCell>Total</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.token_by_mode.map((row) => (
                  <TableRow key={row.mode}>
                    <TableCell>{row.mode}</TableCell>
                    <TableCell>{row.prompt_tokens.toLocaleString()}</TableCell>
                    <TableCell>{row.completion_tokens.toLocaleString()}</TableCell>
                    <TableCell>{(row.prompt_tokens + row.completion_tokens).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className={styles.tableCard}>
          <CardHeader header={<Text className={styles.tableTitle}>Token Usage by Model (30 days)</Text>} />
          <div className={styles.tableWrap}>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Model</TableHeaderCell>
                  <TableHeaderCell>Input</TableHeaderCell>
                  <TableHeaderCell>Output</TableHeaderCell>
                  <TableHeaderCell>Total</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.token_by_model.map((row) => (
                  <TableRow key={row.model}>
                    <TableCell>
                      <Text style={{ fontSize: "11px", fontFamily: "monospace" }}>
                        {row.model.length > 24 ? `${row.model.slice(0, 24)}…` : row.model}
                      </Text>
                    </TableCell>
                    <TableCell>{row.prompt_tokens.toLocaleString()}</TableCell>
                    <TableCell>{row.completion_tokens.toLocaleString()}</TableCell>
                    <TableCell>{(row.prompt_tokens + row.completion_tokens).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className={styles.tableCard}>
          <CardHeader header={<Text className={styles.tableTitle}>Token Usage by User (30 days)</Text>} />
          <div className={styles.tableWrap}>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>User ID</TableHeaderCell>
                  <TableHeaderCell>Input</TableHeaderCell>
                  <TableHeaderCell>Output</TableHeaderCell>
                  <TableHeaderCell>Total</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.token_by_user.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell>
                      <Text style={{ fontSize: "11px", fontFamily: "monospace" }}>{row.user_id}</Text>
                    </TableCell>
                    <TableCell>{row.prompt_tokens.toLocaleString()}</TableCell>
                    <TableCell>{row.completion_tokens.toLocaleString()}</TableCell>
                    <TableCell>{(row.prompt_tokens + row.completion_tokens).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
