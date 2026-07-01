import { useState } from "react";
import {
  Button,
  Text,
  Badge,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular, ArrowResetRegular } from "@fluentui/react-icons";
import { useEngagementWorkspace } from "../hooks/useEngagementWorkspace";
import { clearEngagementWorkspaceLocal } from "../hooks/usePersistentPanelState";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { fontWeight: 600, fontSize: "13px" },
  meta: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  empty: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  list: { display: "flex", flexDirection: "column", gap: "6px" },
  item: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "8px",
    padding: "8px 10px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
  },
  itemLeft: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0, flex: 1 },
  itemTitleRow: { display: "flex", gap: "6px", alignItems: "center" },
  itemTitle: { fontSize: "12px", fontWeight: 600 },
  itemSummary: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

function relativeTime(ms: number): string {
  const deltaSec = Math.max(0, (Date.now() - ms) / 1000);
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

export function EngagementWorkspaceSection({ engagementId }: { engagementId: string }) {
  const styles = useStyles();
  const { items, loading, error, remove, clear } = useEngagementWorkspace(engagementId);
  const [clearing, setClearing] = useState(false);

  async function startOver() {
    if (!confirm("Start over? This clears all saved tool outputs and screen drafts for this engagement.")) {
      return;
    }
    setClearing(true);
    try {
      await clear();
    } catch {
      /* surfaced via hook error */
    } finally {
      // Wipe local panel drafts too so screens reset alongside the server workspace.
      clearEngagementWorkspaceLocal(engagementId);
      setClearing(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <Text className={styles.title}>Workspace</Text>
          <div className={styles.meta}>
            Saved tool outputs — recalled by every tool while this engagement is active
          </div>
        </div>
        <Button
          size="small"
          appearance="secondary"
          icon={clearing ? <Spinner size="tiny" /> : <ArrowResetRegular />}
          disabled={clearing || loading || items.length === 0}
          onClick={startOver}
        >
          {clearing ? "Clearing…" : "Start over"}
        </Button>
      </div>

      {error && (
        <Text style={{ fontSize: "11px", color: tokens.colorPaletteRedForeground1 }}>
          {error}
        </Text>
      )}

      {items.length === 0 ? (
        <Text className={styles.empty}>
          No saved outputs yet. As you run tools (naming standards, cost worksheets,
          landing-zone plans…) their results are saved here and folded into the
          assistant's context so later tools build on them.
        </Text>
      ) : (
        <div className={styles.list}>
          {items.map((a) => (
            <div key={a.id} className={styles.item}>
              <div className={styles.itemLeft}>
                <div className={styles.itemTitleRow}>
                  <Badge appearance="outline" size="small">{a.tool}</Badge>
                  <span className={styles.itemTitle}>{a.title}</span>
                </div>
                {a.summary && <span className={styles.itemSummary}>{a.summary}</span>}
                <span className={styles.meta}>{relativeTime(a.updated_at)}</span>
              </div>
              <Button
                size="small"
                appearance="subtle"
                icon={<DeleteRegular />}
                aria-label={`Delete ${a.title}`}
                onClick={() => remove(a.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
