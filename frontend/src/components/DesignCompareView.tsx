import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  TabList,
  Tab,
} from "@fluentui/react-components";
import { DismissRegular, ArrowSwapRegular } from "@fluentui/react-icons";
import type { SavedDesign } from "../utils/bundledDesignStore";

type PillarKey = "architecture" | "sizing" | "security" | "waf";

const PILLARS: { key: PillarKey; label: string }[] = [
  { key: "architecture", label: "Architecture" },
  { key: "sizing", label: "Sizing" },
  { key: "security", label: "Security" },
  { key: "waf", label: "WAF Assessment" },
];

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    minHeight: "50vh",
    maxHeight: "65vh",
  },
  col: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "12px",
    overflowY: "auto",
  },
  colTitle: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginBottom: "8px",
  },
  diffLine: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
    whiteSpace: "pre-wrap",
    padding: "1px 6px",
    borderRadius: "2px",
  },
  diffAdd: {
    background: "rgba(46, 160, 67, 0.18)",
    color: tokens.colorStatusSuccessForeground1,
  },
  diffDel: {
    background: "rgba(248, 81, 73, 0.18)",
    color: tokens.colorStatusDangerForeground1,
  },
  mdContent: {
    fontSize: "12px",
    lineHeight: 1.5,
    "& pre": { background: tokens.colorNeutralBackground3, borderRadius: "4px", padding: "8px", overflowX: "auto" },
  },
});

function pillarText(d: SavedDesign, key: PillarKey): string {
  const b = d.bundle;
  if (key === "architecture") {
    const parts = [b.architecture.text || ""];
    if (b.architecture.runbook) parts.push("\n### Runbook\n" + b.architecture.runbook);
    if (b.architecture.bicep) parts.push("\n### Bicep\n```bicep\n" + b.architecture.bicep + "\n```");
    return parts.join("\n");
  }
  if (key === "sizing") return b.sizing.text || "";
  if (key === "security") return b.security.text || "";
  if (key === "waf") {
    return (b.waf.pillars || [])
      .map((p) => `### ${p.pillar} — ${p.score}/5\n${(p.recommendations || []).map((r) => `- ${typeof r === "string" ? r : r.text}`).join("\n")}`)
      .join("\n\n");
  }
  return "";
}

interface DiffLine {
  text: string;
  kind: "same" | "add" | "del";
}

function lineDiff(left: string, right: string): { leftLines: DiffLine[]; rightLines: DiffLine[] } {
  const a = left.split("\n");
  const b = right.split("\n");
  const setA = new Set(a);
  const setB = new Set(b);
  const leftLines: DiffLine[] = a.map((line) => ({
    text: line,
    kind: setB.has(line) ? "same" : "del",
  }));
  const rightLines: DiffLine[] = b.map((line) => ({
    text: line,
    kind: setA.has(line) ? "same" : "add",
  }));
  return { leftLines, rightLines };
}

export interface DesignCompareViewProps {
  left: SavedDesign;
  right: SavedDesign;
  onClose: () => void;
  onSwap: () => void;
}

export default function DesignCompareView({ left, right, onClose, onSwap }: DesignCompareViewProps) {
  const styles = useStyles();
  const [pillar, setPillar] = useState<PillarKey>("architecture");
  const [mode, setMode] = useState<"diff" | "rendered">("diff");

  const leftText = useMemo(() => pillarText(left, pillar), [left, pillar]);
  const rightText = useMemo(() => pillarText(right, pillar), [right, pillar]);
  const { leftLines, rightLines } = useMemo(() => lineDiff(leftText, rightText), [leftText, rightText]);

  function renderDiffCol(lines: DiffLine[]) {
    return (
      <div>
        {lines.map((l, i) => (
          <div
            key={i}
            className={`${styles.diffLine} ${l.kind === "add" ? styles.diffAdd : l.kind === "del" ? styles.diffDel : ""}`}
          >
            {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}
            {l.text || "\u00A0"}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text weight="semibold">Compare Designs</Text>
        <TabList selectedValue={pillar} onTabSelect={(_, d) => setPillar(d.value as PillarKey)}>
          {PILLARS.map((p) => (
            <Tab key={p.key} value={p.key}>{p.label}</Tab>
          ))}
        </TabList>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <Button
            appearance="subtle"
            size="small"
            onClick={() => setMode(mode === "diff" ? "rendered" : "diff")}
          >
            {mode === "diff" ? "Show Rendered" : "Show Diff"}
          </Button>
          <Button appearance="subtle" size="small" icon={<ArrowSwapRegular />} onClick={onSwap}>
            Swap
          </Button>
          <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <div className={styles.twoCol}>
        <div className={styles.col}>
          <div className={styles.colTitle}>
            A · {left.bundle.workload_name} · {new Date(left.saved_at).toLocaleString()}
          </div>
          {mode === "diff" ? (
            renderDiffCol(leftLines)
          ) : (
            <div className={styles.mdContent}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{leftText || "_empty_"}</ReactMarkdown>
            </div>
          )}
        </div>
        <div className={styles.col}>
          <div className={styles.colTitle}>
            B · {right.bundle.workload_name} · {new Date(right.saved_at).toLocaleString()}
          </div>
          {mode === "diff" ? (
            renderDiffCol(rightLines)
          ) : (
            <div className={styles.mdContent}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{rightText || "_empty_"}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
