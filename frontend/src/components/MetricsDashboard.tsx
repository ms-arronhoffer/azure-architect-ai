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
import { ArrowSyncRegular } from "@fluentui/react-icons";
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

interface MetricsResponse {
  total_conversations: number;
  unique_users: number;
  active_today: number;
  weekly_active: number;
  avg_duration_min: number;
  output_rate_pct: number;
  wow_pct: number;
  mode_breakdown: ModeCount[];
  dau_30d: DauRow[];
  top_users: TopUser[];
  token_by_model: TokenByModel[];
  token_by_user: TokenByUser[];
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    padding: "24px",
    overflowY: "auto",
    height: "100%",
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
});

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function wowLabel(pct: number): string {
  if (pct === 0) return "—";
  return `${pct > 0 ? "+" : ""}${pct}%`;
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
          const text = await r.text().catch(() => r.statusText);
          throw new Error(`${r.status}: ${text}`);
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
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <Text size={500} weight="semibold">Usage Metrics</Text>
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
      </div>

      <div className={styles.heroRow}>
        <Card className={styles.heroCard}>
          <div className={styles.heroValue}>{data.total_conversations.toLocaleString()}</div>
          <div className={styles.heroLabel}>Total Conversations</div>
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
          <div className={styles.heroValue}>{data.avg_duration_min > 0 ? `${data.avg_duration_min}m` : "—"}</div>
          <div className={styles.heroLabel}>Avg Session Duration</div>
        </Card>
        <Card className={styles.heroCard}>
          <div className={styles.heroValue}>{data.output_rate_pct}%</div>
          <div className={styles.heroLabel}>Output Generated Rate</div>
        </Card>
        <Card className={styles.heroCard}>
          <div className={wowPositive ? styles.heroValuePositive : wowNegative ? styles.heroValueNegative : styles.heroValue}>
            {wowLabel(data.wow_pct)}
          </div>
          <div className={styles.heroLabel}>Week-over-Week Growth</div>
        </Card>
      </div>

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
