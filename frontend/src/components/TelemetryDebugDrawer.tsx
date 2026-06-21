import { useState, useEffect } from "react";
import {
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  Button,
  Text,
  Divider,
  tokens,
  makeStyles,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { getStats, resetStats, type TelemetryState } from "../utils/telemetry";

const useStyles = makeStyles({
  row: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
    fontSize: "13px",
  },
  section: {
    marginTop: "12px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
  },
});

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function TelemetryDebugDrawer({ open, onClose }: Props) {
  const styles = useStyles();
  const [stats, setStats] = useState<TelemetryState | null>(null);

  useEffect(() => {
    if (open) setStats(getStats());
  }, [open]);

  function handleReset() {
    resetStats();
    setStats(getStats());
  }

  if (!stats) return null;

  const totalModeOpens = Object.values(stats.modeOpens).reduce((s, n) => s + (n || 0), 0);

  return (
    <Drawer open={open} onOpenChange={(_, d) => !d.open && onClose()} position="end" size="medium">
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" icon={<DismissRegular />} onClick={onClose} aria-label="Close" />
          }
        >
          Telemetry (Local)
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          All counters are local to this browser. Nothing is sent to a server.
        </Text>
        <Divider style={{ margin: "12px 0" }} />

        <div className={styles.section}>Runs</div>
        <div className={styles.row}><span>Quick (parallel) runs</span><span>{stats.quickRuns}</span></div>
        <div className={styles.row}><span>Pipeline runs</span><span>{stats.pipelineRuns}</span></div>
        <div className={styles.row}><span>Pipeline completions</span><span>{stats.pipelineCompletions}</span></div>
        <div className={styles.row}><span>Pipeline cancellations</span><span>{stats.pipelineCancellations}</span></div>

        <div className={styles.section}>Designs</div>
        <div className={styles.row}><span>Saved</span><span>{stats.designsSaved}</span></div>
        <div className={styles.row}><span>Exported</span><span>{stats.designsExported}</span></div>
        <div className={styles.row}><span>Compared</span><span>{stats.designsCompared}</span></div>

        <div className={styles.section}>Autofills applied</div>
        <div className={styles.row}><span>Strategy → Spec</span><span>{stats.autofillApplied.strategy}</span></div>
        <div className={styles.row}><span>Spec → Architecture</span><span>{stats.autofillApplied.architecture}</span></div>

        <div className={styles.section}>Modes opened ({totalModeOpens} total)</div>
        {Object.entries(stats.modeOpens)
          .sort((a, b) => (b[1] || 0) - (a[1] || 0))
          .slice(0, 12)
          .map(([m, n]) => (
            <div key={m} className={styles.row}><span>{m}</span><span>{n}</span></div>
          ))}

        <Divider style={{ margin: "16px 0" }} />
        <div className={styles.row}><span>First seen</span><span>{new Date(stats.firstSeen).toLocaleString()}</span></div>
        <div className={styles.row}><span>Last seen</span><span>{new Date(stats.lastSeen).toLocaleString()}</span></div>

        <Button appearance="outline" onClick={handleReset} style={{ marginTop: "16px" }}>
          Reset all counters
        </Button>
      </DrawerBody>
    </Drawer>
  );
}
