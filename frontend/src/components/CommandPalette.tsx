import { useEffect, useRef, useState } from "react";
import { makeStyles, tokens, Text } from "@fluentui/react-components";
import {
  SearchRegular,
  BuildingRegular,
  ChatRegular,
  ShieldCheckmarkRegular,
  WrenchScrewdriverRegular,
  FormRegular,
  DataUsageRegular,
  MegaphoneLoudRegular,
  HeartPulseRegular,
  CalendarRegular,
  TargetRegular,
  ChartMultipleRegular,
  LayerRegular,
  RocketRegular,
  TagRegular,
  BookRegular,
  PlayCircleRegular,
  GlobeRegular,
  ServerRegular,
  SparkleRegular,
  DataBarVerticalRegular,
  ShieldErrorRegular,
  CodeRegular,
  BranchForkRegular,
  DocumentBulletListRegular,
  ArrowSwapRegular,
  SlideTextRegular,
  BoardRegular,
  ClipboardTaskRegular,
  ArrowSyncRegular,
} from "@fluentui/react-icons";
import type { Mode } from "../types";

interface CommandItem {
  mode: Mode;
  label: string;
  description: string;
  section: string;
  icon: React.ReactNode;
}

const COMMAND_ITEMS: CommandItem[] = [
  { mode: "architect", label: "Architect", description: "Design, IaC, diagrams, WAF", section: "Agents", icon: <BuildingRegular /> },
  { mode: "cost", label: "Cost & FinOps", description: "Pricing, reservations, right-sizing", section: "Agents", icon: <DataUsageRegular /> },
  { mode: "operations", label: "Operations", description: "Reliability, troubleshoot, DRBC, runbooks", section: "Agents", icon: <WrenchScrewdriverRegular /> },
  { mode: "compliance", label: "Compliance & Security", description: "Security posture, threat model, DevSecOps", section: "Agents", icon: <ShieldCheckmarkRegular /> },
  { mode: "engagement", label: "Engagement Hub", description: "Intake, RFPs, exec content, learning", section: "Agents", icon: <FormRegular /> },
  { mode: "whatsnew", label: "What's New", description: "Microsoft announcements & updates", section: "Updates", icon: <MegaphoneLoudRegular /> },
  { mode: "servicehealth", label: "Service Health", description: "Azure service incidents", section: "Updates", icon: <HeartPulseRegular /> },
  { mode: "modellifecycle", label: "Model Lifecycle", description: "Azure Foundry model retirement schedule", section: "Updates", icon: <CalendarRegular /> },
  { mode: "qa", label: "Expert Advisor", description: "14 cross-domain advisors", section: "Advise", icon: <ChatRegular /> },
  { mode: "learningplan", label: "Learning Plan", description: "Build structured training plans", section: "Advise", icon: <BoardRegular /> },
  { mode: "presentation", label: "Presentation Coach", description: "Structure Azure topics for any audience", section: "Advise", icon: <SlideTextRegular /> },
  { mode: "intake", label: "Requirements Studio", description: "Capture workload requirements", section: "Plan", icon: <FormRegular /> },
  { mode: "intakechat", label: "Guided Discovery", description: "Conversational intake driven by confidence gaps", section: "Plan", icon: <FormRegular /> },
  { mode: "analyze", label: "Workload Analysis", description: "Architecture + WAF + Security in one click", section: "Plan", icon: <ChartMultipleRegular /> },
  { mode: "cost-optimize", label: "Cost Optimize", description: "7-phase cost pipeline with narrated report", section: "Plan", icon: <DataUsageRegular /> },
  { mode: "strategy", label: "Strategy Builder", description: "AI-generated Azure strategy document", section: "Plan", icon: <TargetRegular /> },
  { mode: "architecture", label: "Architecture Design", description: "Architecture, Network, AI, Data Platform", section: "Design", icon: <BuildingRegular /> },
  { mode: "landingzone", label: "Landing Zone", description: "Azure CAF landing zone design", section: "Design", icon: <LayerRegular /> },
  { mode: "demo-build", label: "Demo Builder", description: "Generate a clone-and-run Azure demo", section: "Design", icon: <RocketRegular /> },
  { mode: "namingstandards", label: "Naming Standards", description: "CAF naming conventions + enforcement", section: "Design", icon: <TagRegular /> },
  { mode: "refarch", label: "Reference Architectures", description: "Official MS reference architectures", section: "Design", icon: <BookRegular /> },
  { mode: "showcase", label: "Demo Showcase", description: "Browse and contribute to demo catalog", section: "Design", icon: <PlayCircleRegular /> },
  { mode: "netvnet", label: "Network Desk", description: "11 specialist advisors for Azure networking", section: "Design", icon: <GlobeRegular /> },
  { mode: "compsku", label: "Compute Desk", description: "10 specialist advisors for Azure compute", section: "Design", icon: <ServerRegular /> },
  { mode: "datalake", label: "Data Desk", description: "Data platforms + pipelines & Fabric tooling", section: "Design", icon: <DataBarVerticalRegular /> },
  { mode: "aifoundry", label: "AI Desk", description: "10 specialist advisors for Azure AI workloads", section: "Design", icon: <SparkleRegular /> },
  { mode: "waf", label: "WAF Assessment", description: "Score all 5 WAF pillars", section: "Assess", icon: <ShieldCheckmarkRegular /> },
  { mode: "review", label: "Architecture Review", description: "Red team your architecture for gaps", section: "Assess", icon: <ClipboardTaskRegular /> },
  { mode: "threatmodel", label: "Threat Model", description: "STRIDE analysis, attack surface & controls", section: "Assess", icon: <ShieldErrorRegular /> },
  { mode: "drbc", label: "DR/BC Design", description: "Recovery strategies and failover runbooks", section: "Assess", icon: <ArrowSyncRegular /> },
  { mode: "reliability", label: "Reliability & SLO", description: "SLO design, FMEA, chaos experiments", section: "Assess", icon: <HeartPulseRegular /> },
  { mode: "codegen", label: "Code Generator", description: "Generate code with Copilot", section: "Build & Run", icon: <CodeRegular /> },
  { mode: "pipelineforge", label: "Pipeline Forge", description: "Generate CI/CD pipelines", section: "Build & Run", icon: <BranchForkRegular /> },
  { mode: "runbookstudio", label: "Runbook Studio", description: "Generate SRE runbooks", section: "Build & Run", icon: <DocumentBulletListRegular /> },
  { mode: "troubleshoot", label: "Troubleshoot", description: "Diagnose and resolve Azure issues", section: "Build & Run", icon: <WrenchScrewdriverRegular /> },
  { mode: "modelmigration", label: "Model IQ", description: "Score model migrations and plan PTU capacity", section: "Reports", icon: <ArrowSwapRegular /> },
];

const useStyles = makeStyles({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "15vh",
    background: "rgba(0,0,0,0.5)",
    backdropFilter: "blur(2px)",
  },
  dialog: {
    width: "520px",
    maxHeight: "440px",
    display: "flex",
    flexDirection: "column",
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "12px",
    boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
    overflow: "hidden",
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  searchIcon: {
    color: tokens.colorNeutralForeground3,
    fontSize: "18px",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: "15px",
    color: tokens.colorNeutralForeground1,
    "::placeholder": {
      color: tokens.colorNeutralForeground4,
    },
  },
  hint: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
    flexShrink: 0,
  },
  results: {
    flex: 1,
    overflowY: "auto",
    padding: "6px 0",
  },
  sectionLabel: {
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: tokens.colorNeutralForeground4,
    padding: "8px 16px 4px",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 16px",
    cursor: "pointer",
    "&:hover": {
      background: "rgba(0, 120, 212, 0.08)",
    },
  },
  itemActive: {
    background: "rgba(0, 120, 212, 0.12)",
  },
  itemIcon: {
    fontSize: "16px",
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  itemText: {
    flex: 1,
    overflow: "hidden",
  },
  itemLabel: {
    fontSize: "14px",
    fontWeight: 500,
    color: tokens.colorNeutralForeground1,
  },
  itemDesc: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    padding: "24px 16px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
    fontSize: "13px",
  },
});

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (mode: Mode) => void;
}

export default function CommandPalette({ open, onClose, onSelect }: CommandPaletteProps) {
  const styles = useStyles();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = query.trim()
    ? COMMAND_ITEMS.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.description.toLowerCase().includes(query.toLowerCase()) ||
          item.section.toLowerCase().includes(query.toLowerCase())
      )
    : COMMAND_ITEMS;

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[activeIndex]) {
          onSelect(filtered[activeIndex].mode);
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, filtered, activeIndex, onClose, onSelect]);

  if (!open) return null;

  // Group filtered results by section
  const sections: Record<string, CommandItem[]> = {};
  for (const item of filtered) {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  }

  let runningIndex = 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <SearchRegular className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search tools and modes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Text className={styles.hint}>esc to close</Text>
        </div>
        <div className={styles.results}>
          {filtered.length === 0 && (
            <div className={styles.empty}>No matching tools found</div>
          )}
          {Object.entries(sections).map(([section, items]) => (
            <div key={section}>
              <div className={styles.sectionLabel}>{section}</div>
              {items.map((item) => {
                const idx = runningIndex++;
                return (
                  <div
                    key={item.mode}
                    className={`${styles.item} ${idx === activeIndex ? styles.itemActive : ""}`}
                    onClick={() => {
                      onSelect(item.mode);
                      onClose();
                    }}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <span className={styles.itemIcon}>{item.icon}</span>
                    <div className={styles.itemText}>
                      <div className={styles.itemLabel}>{item.label}</div>
                      <div className={styles.itemDesc}>{item.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
