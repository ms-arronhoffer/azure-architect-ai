import { useCallback, useEffect, useRef, useState } from "react";
import {
  makeStyles,
  tokens,
  Card,
  CardHeader,
  Text,
  Button,
  Spinner,
  Popover,
  PopoverTrigger,
  PopoverSurface,
} from "@fluentui/react-components";
import {
  CloudRegular,
  CheckmarkCircleFilled,
  InfoRegular,
  PlayRegular,
  ArrowResetRegular,
} from "@fluentui/react-icons";
import type { DemoLiveActivityStep } from "../types";

/**
 * In-app preview of the running demo's Azure Activity Panel. Replays the
 * design's `live_activity` script with timers — the same mocked playback the
 * generated demo exposes via `?mock=1` — so a customer can *see* the
 * service-attributed "behind the scenes" experience before the demo is ever
 * deployed. This is the Demo Builder's window into the world-class UX the
 * pipeline now generates.
 */

type StepStatus = "pending" | "active" | "done";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px" },
  controls: { display: "flex", alignItems: "center", gap: "8px" },
  rail: { display: "flex", flexDirection: "column", gap: "8px" },
  chip: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    transition: "all 0.25s ease",
  },
  chipActive: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    boxShadow: `0 0 0 3px ${tokens.colorBrandBackground2}`,
    background: tokens.colorBrandBackground2,
  },
  chipDone: { border: `1px solid ${tokens.colorPaletteGreenBorder2}` },
  chipPending: { opacity: 0.55 },
  chipMeta: { marginLeft: "auto", display: "flex", gap: "6px", alignItems: "center" },
  feed: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    maxHeight: "200px",
    overflowY: "auto",
    marginTop: "4px",
  },
  feedItem: {
    padding: "6px 10px",
    borderLeft: `2px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorNeutralBackground2,
    borderRadius: "4px",
    fontSize: "12px",
  },
  empty: { color: tokens.colorNeutralForeground3 },
});

interface Props {
  steps: DemoLiveActivityStep[];
  roles: Array<{ service: string; role: string }>;
}

export function DemoActivityPreview({ steps, roles }: Props) {
  const styles = useStyles();
  const [statusById, setStatusById] = useState<Record<string, StepStatus>>({});
  const [narrative, setNarrative] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const timers = useRef<number[]>([]);

  const roleFor = (svc: string) => roles.find((r) => r.service.toLowerCase() === svc.toLowerCase())?.role;

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  const play = useCallback(() => {
    clearTimers();
    setStatusById({});
    setNarrative([]);
    setPlaying(true);
    let at = 0;
    steps.forEach((step) => {
      const dur = Math.min(Math.max(step.duration_ms ?? 900, 300), 4000);
      timers.current.push(
        window.setTimeout(() => {
          setStatusById((p) => ({ ...p, [step.step_id]: "active" }));
          if (step.detail) {
            setNarrative((p) => [...p, step.detail as string]);
          }
        }, at),
      );
      at += dur;
      timers.current.push(
        window.setTimeout(() => {
          setStatusById((p) => ({ ...p, [step.step_id]: "done" }));
        }, at),
      );
    });
    timers.current.push(window.setTimeout(() => setPlaying(false), at + 100));
  }, [steps, clearTimers]);

  // Auto-play once when steps first arrive; clean up timers on unmount.
  useEffect(() => {
    if (steps.length > 0) play();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  if (steps.length === 0) {
    return (
      <Text className={styles.empty}>
        No live activity script was produced for this demo. The generated app still ships the Azure Activity
        Panel; the design phase did not emit a mock playback script to preview here.
      </Text>
    );
  }

  return (
    <Card className={styles.root}>
      <CardHeader
        header={<Text weight="semibold">Live preview — Azure activity (mocked)</Text>}
        action={
          <div className={styles.controls}>
            {playing && <Spinner size="tiny" />}
            <Button
              size="small"
              appearance="subtle"
              icon={playing ? <ArrowResetRegular /> : <PlayRegular />}
              onClick={play}
            >
              {playing ? "Restart" : "Replay"}
            </Button>
          </div>
        }
      />
      <Text size={200} className={styles.empty}>
        This is exactly what the audience sees in the running demo: each Azure service lights up as it is
        called, with a plain-language explanation of what it is doing. No deployment required.
      </Text>
      <div className={styles.rail}>
        {steps.map((step) => {
          const status: StepStatus = statusById[step.step_id] ?? "pending";
          const cls = `${styles.chip} ${
            status === "active" ? styles.chipActive : status === "done" ? styles.chipDone : styles.chipPending
          }`;
          const role = roleFor(step.service);
          return (
            <div key={step.step_id} className={cls}>
              <CloudRegular />
              <div>
                <Text weight="semibold">{step.service}</Text> <Text size={200}>· {step.stage}</Text>
              </div>
              <div className={styles.chipMeta}>
                {status === "active" && <Spinner size="tiny" />}
                {status === "done" && (
                  <CheckmarkCircleFilled style={{ color: tokens.colorPaletteGreenForeground1 }} />
                )}
                {role && (
                  <Popover withArrow>
                    <PopoverTrigger disableButtonEnhancement>
                      <InfoRegular
                        tabIndex={0}
                        aria-label={`What ${step.service} does`}
                        style={{ cursor: "pointer" }}
                      />
                    </PopoverTrigger>
                    <PopoverSurface>
                      <Text size={200}>{role}</Text>
                    </PopoverSurface>
                  </Popover>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {narrative.length > 0 && (
        <div className={styles.feed}>
          {narrative.map((n, i) => (
            <div key={i} className={styles.feedItem}>
              {n}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
