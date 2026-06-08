import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
} from "@fluentui/react-components";
import {
  HeartPulseRegular,
  CheckmarkCircleRegular,
  ArrowClockwiseRegular,
  OpenRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import type { Announcement } from "../types";

interface ServiceHealthPanelProps {
  incidents: Announcement[];
  loading: boolean;
  error: string | null;
  lastChecked: Date | null;
  onRefresh: (force?: boolean) => void;
}

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
    color: "#00B7C3",
    filter: "drop-shadow(0 0 8px rgba(0,183,195,0.5))",
  },
  title: {
    fontSize: "18px",
    fontWeight: 700,
    color: tokens.colorNeutralForeground1,
    lineHeight: 1.2,
    marginBottom: "2px",
  },
  subtitle: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground4,
  },
  content: {
    flex: 1,
    overflowY: "auto",
    padding: "24px 28px",
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
  allHealthy: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    padding: "60px 0",
  },
  healthyIcon: {
    fontSize: "56px",
    color: "#107C10",
    filter: "drop-shadow(0 0 12px rgba(16,124,16,0.4))",
  },
  healthyTitle: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#107C10",
  },
  healthySubtitle: {
    fontSize: "14px",
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
    maxWidth: "400px",
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1,
  },
  incidentList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  sectionLabel: {
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: tokens.colorNeutralForeground4,
    marginBottom: "8px",
    marginTop: "8px",
  },
  card: {
    background: "var(--glass-bg)",
    border: "1px solid var(--glass-border)",
    borderRadius: "10px",
    padding: "16px",
    boxShadow: "var(--glass-shadow)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "8px",
  },
  severityBadge: {
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "10px",
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
  },
  cardDate: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
    flex: 1,
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
    marginBottom: "6px",
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
  warningIcon: {
    fontSize: "20px",
    color: "#FFA500",
    flexShrink: 0,
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

export default function ServiceHealthPanel({ incidents, loading, error, lastChecked, onRefresh }: ServiceHealthPanelProps) {
  const styles = useStyles();

  return (
    <div className={styles.root}>
      <div className={styles.panelHeader}>
        <div className={styles.headerLeft}>
          <HeartPulseRegular className={styles.headerIcon} />
          <div>
            <div className={styles.title}>Azure Service Health</div>
            {lastChecked && (
              <Text className={styles.subtitle}>
                Updated {lastChecked.toLocaleTimeString()}
              </Text>
            )}
          </div>
        </div>
        <Button
          appearance="subtle"
          icon={<ArrowClockwiseRegular />}
          onClick={() => onRefresh(true)}
          disabled={loading}
          size="small"
        >
          Refresh
        </Button>
      </div>

      <div className={styles.content}>
        {loading && (
          <div className={styles.centered}>
            <Spinner label="Checking Azure service health…" />
          </div>
        )}
        {error && !loading && (
          <div className={styles.centered}>
            <Text className={styles.errorText}>{error}</Text>
            <Button onClick={() => onRefresh()} appearance="subtle">Try Again</Button>
          </div>
        )}
        {!loading && !error && incidents.length === 0 && (
          <div className={styles.allHealthy}>
            <CheckmarkCircleRegular className={styles.healthyIcon} />
            <Text className={styles.healthyTitle}>All Azure Services Operational</Text>
            <Text className={styles.healthySubtitle}>
              No active incidents or service health advisories at this time.
              Data sourced from the Azure Service Health RSS feed.
            </Text>
          </div>
        )}
        {!loading && !error && incidents.length > 0 && (
          <div className={styles.incidentList}>
            <Text className={styles.sectionLabel}>
              {incidents.length} Active Incident{incidents.length !== 1 ? "s" : ""}
            </Text>
            {incidents.map((incident) => (
              <div key={incident.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <WarningRegular className={styles.warningIcon} />
                  <span
                    className={styles.severityBadge}
                    style={{ background: "#D83B01" }}
                  >
                    Incident
                  </span>
                  <span className={styles.cardDate}>{formatRelativeDate(incident.pub_date)}</span>
                </div>
                <a
                  href={incident.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.cardTitle}
                >
                  {incident.title}
                  <OpenRegular className={styles.externalIcon} />
                </a>
                {incident.description && (
                  <Text className={styles.cardDescription}>{incident.description}</Text>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
