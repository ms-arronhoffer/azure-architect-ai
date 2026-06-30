import { JSX, useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Tooltip,
} from "@fluentui/react-components";
import {
  ChatRegular,
  SlideTextRegular,
  BuildingRegular,
  ShieldCheckmarkRegular,
  ClipboardTaskRegular,
  ArrowSyncRegular,
  ArrowSwapRegular,
  CodeRegular,
  BoardRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  ChevronDownRegular,
  RocketRegular,
  FormRegular,
  CalendarRegular,
  ChartMultipleRegular,
  LayerRegular,
  ShieldErrorRegular,
  HeartPulseRegular,
  WrenchScrewdriverRegular,
  MegaphoneLoudRegular,
  TargetRegular,
  DataUsageRegular,
  MoneyCalculatorRegular,
  BranchForkRegular,
  DocumentBulletListRegular,
  TagRegular,
  PlayCircleRegular,
  GlobeRegular,
  ServerRegular,
  SparkleRegular,
  DataBarVerticalRegular,
  BookRegular,
  StarFilled,
  StarRegular,
  PinRegular,
  PuzzlePieceRegular,
  PlugConnectedRegular,
} from "@fluentui/react-icons";
import type { Mode } from "../types";
import { unifiedAgentsEnabled } from "../constants/modeGroups";
import { getCustomSkills } from "../config/runtimeFlags";
import { useAuth } from "../auth/AuthProvider";
import NavItemHowTo from "./NavItemHowTo";

interface NavItemDef {
  mode: Mode;
  label: string;
  icon: JSX.Element;
  description: string;
  activeWhen?: Mode[];
}

interface NavSubheadingDef {
  subheading: string;
}

type NavEntry = NavItemDef | NavSubheadingDef;

function isSubheading(entry: NavEntry): entry is NavSubheadingDef {
  return (entry as NavSubheadingDef).subheading !== undefined;
}

interface NavSectionDef {
  label: string;
  items: NavEntry[];
}

const ADVISOR_MODES: Mode[] = [
  "qa", "situation", "certprep", "regional", "compare",
  "governance", "compliance", "identity",
  "security", "devsecops",
  "migration", "cost", "monitoring", "ops",
];

const ARCH_MODES: Mode[] = ["architecture", "network", "aiarchitecture", "dataplatform", "apim"];

const NETWORK_DESK_MODES: Mode[] = [
  "netvnet", "netfirewall", "netsecurity", "nethybrid", "netprivatelink",
  "netvwan", "netdns", "netmonitor", "nettroubleshoot", "netiac", "netpricing",
];

const COMPUTE_DESK_MODES: Mode[] = [
  "compsku", "compscale", "compdisk", "compha", "compdr",
  "compperf", "compmonitor", "comptroubleshoot", "compsecurity", "compcost",
];

const AI_DESK_MODES: Mode[] = [
  "aifoundry", "aimodel", "airag", "aiagents", "aifinetune",
  "aimlops", "aieval", "aisafety", "aicost", "aiiac",
];

const DATA_DESK_MODES: Mode[] = [
  "datalake", "datawarehouse", "datastream", "datalakehouse", "datagovernance",
  "datasecurity", "datamigration", "datacost", "dataquality", "dataiac",
  "datapipelineadvisor", "fabricplanner", "adfpipeline", "medalliondesigner",
];

const NAV_SECTIONS: NavSectionDef[] = [
  {
    label: "Agents",
    items: [
      { mode: "architect", label: "Architect", icon: <BuildingRegular />, description: "Design, IaC, diagrams, WAF, landing zone, AVM, AI, network, identity, data" },
      { mode: "cost", label: "Cost & FinOps", icon: <DataUsageRegular />, description: "Pricing, reservations, right-sizing, carbon, anomaly detection" },
      { mode: "operations", label: "Operations", icon: <WrenchScrewdriverRegular />, description: "Reliability, troubleshoot, DRBC, runbooks, monitoring, service health" },
      { mode: "compliance", label: "Compliance & Security", icon: <ShieldCheckmarkRegular />, description: "Security posture, threat model, DevSecOps, compliance mapping" },
      { mode: "engagement", label: "Engagement Hub", icon: <FormRegular />, description: "Intake, RFPs, exec content, what's new, learning plans" },
    ],
  },
  {
    label: "Updates",
    items: [
      { mode: "whatsnew", label: "What's New", icon: <MegaphoneLoudRegular />, description: "Microsoft announcements & draft customer emails" },
      { mode: "servicehealth", label: "Service Health", icon: <HeartPulseRegular />, description: "Azure service incidents and health advisories" },
      { mode: "modellifecycle", label: "Model Lifecycle", icon: <CalendarRegular />, description: "Azure Foundry model retirement schedule" },
    ],
  },
  {
    label: "Advise",
    items: [
      { mode: "qa", label: "Expert Advisor", icon: <ChatRegular />, description: "14 cross-domain advisors", activeWhen: ADVISOR_MODES },
      { mode: "learningplan", label: "Learning Plan", icon: <BoardRegular />, description: "Build structured training plans with outcomes" },
      { mode: "presentation", label: "Presentation Coach", icon: <SlideTextRegular />, description: "Structure Azure topics for any audience" },
    ],
  },
  {
    label: "Plan",
    items: [
      { mode: "intake", label: "Requirements Studio", icon: <FormRegular />, description: "Capture workload requirements — injected everywhere" },
      { mode: "intakechat", label: "Guided Discovery", icon: <FormRegular />, description: "Conversational intake driven by confidence gaps" },
      { mode: "analyze", label: "Workload Analysis", icon: <ChartMultipleRegular />, description: "Architecture + WAF + Security in one click" },
      { mode: "cost-optimize", label: "Cost Optimize", icon: <DataUsageRegular />, description: "Deterministic 7-phase cost pipeline with narrated report" },
      { mode: "pricing-desk", label: "Pricing Desk", icon: <MoneyCalculatorRegular />, description: "Conversational pricing for any Azure service with a live, exportable worksheet" },
      { mode: "strategy", label: "Strategy Builder", icon: <TargetRegular />, description: "AI-generated Azure strategy document" },
    ],
  },
  {
    label: "Design",
    items: [
      { mode: "architecture", label: "Architecture Design", icon: <BuildingRegular />, description: "Architecture, Network, AI, Data Platform, APIM", activeWhen: ARCH_MODES },
      { mode: "landingzone", label: "Landing Zone", icon: <LayerRegular />, description: "Azure CAF landing zone design with management groups" },
      { mode: "demo-build", label: "Demo Builder", icon: <RocketRegular />, description: "Generate a clone-and-run Azure demo: app + Bicep + docs" },
      { mode: "namingstandards", label: "Naming Standards", icon: <TagRegular />, description: "CAF naming conventions + Bicep/Terraform enforcement module" },
      { subheading: "Library" },
      { mode: "refarch", label: "Reference Architectures", icon: <BookRegular />, description: "Official MS reference architectures + custom entries" },
      { mode: "showcase", label: "Demo Showcase", icon: <PlayCircleRegular />, description: "Browse and contribute to the demo catalog" },
      { subheading: "Domain Desks" },
      { mode: "netvnet", label: "Network Desk", icon: <GlobeRegular />, description: "11 specialist advisors for Azure networking", activeWhen: NETWORK_DESK_MODES },
      { mode: "compsku", label: "Compute Desk", icon: <ServerRegular />, description: "10 specialist advisors for Azure compute", activeWhen: COMPUTE_DESK_MODES },
      { mode: "datalake", label: "Data Desk", icon: <DataBarVerticalRegular />, description: "Data platforms + pipelines & Fabric tooling", activeWhen: DATA_DESK_MODES },
      { mode: "aifoundry", label: "AI Desk", icon: <SparkleRegular />, description: "10 specialist advisors for Azure AI workloads", activeWhen: AI_DESK_MODES },
    ],
  },
  {
    label: "Assess",
    items: [
      { mode: "waf", label: "WAF Assessment", icon: <ShieldCheckmarkRegular />, description: "Score all 5 WAF pillars" },
      { mode: "review", label: "Architecture Review", icon: <ClipboardTaskRegular />, description: "Red team your architecture for gaps" },
      { mode: "threatmodel", label: "Threat Model", icon: <ShieldErrorRegular />, description: "STRIDE analysis, attack surface & security controls" },
      { mode: "drbc", label: "DR/BC Design", icon: <ArrowSyncRegular />, description: "Recovery strategies and failover runbooks" },
      { mode: "reliability", label: "Reliability & SLO", icon: <HeartPulseRegular />, description: "SLO design, FMEA, chaos experiments & toil inventory" },
    ],
  },
  {
    label: "Build & Run",
    items: [
      { mode: "codegen", label: "Code Generator", icon: <CodeRegular />, description: "Generate code with Copilot and push to GitHub" },
      { mode: "pipelineforge", label: "Pipeline Forge", icon: <BranchForkRegular />, description: "Generate GitHub Actions & Azure DevOps CI/CD pipelines" },
      { mode: "runbookstudio", label: "Runbook Studio", icon: <DocumentBulletListRegular />, description: "Generate SRE runbooks for Azure failure scenarios" },
      { mode: "troubleshoot", label: "Troubleshoot", icon: <WrenchScrewdriverRegular />, description: "Diagnose and resolve Azure issues" },
    ],
  },
  {
    label: "Reports",
    items: [
      { mode: "modelmigration", label: "Model IQ", icon: <ArrowSwapRegular />, description: "Score model migrations and plan PTU capacity" },
    ],
  },
];

// Curated nav for unified-agents mode. The 5 agents absorb the 30+ desk/
// specialist panels via chat-based flow; only a handful of standalone
// browser/discovery surfaces are kept alongside (per the trusted-oracle plan).
const UNIFIED_NAV_SECTIONS: NavSectionDef[] = [
  {
    label: "Start here",
    items: [
      { mode: "ask", label: "Ask", icon: <SparkleRegular />, description: "One front door — the router picks the right agent and offers a guided tool when it helps" },
    ],
  },
  NAV_SECTIONS.find((s) => s.label === "Agents")!,
  {
    label: "Tools",
    items: [
      NAV_SECTIONS.find((s) => s.label === "Design")!.items.find(
        (i) => !isSubheading(i) && i.mode === "demo-build",
      )!,
    ],
  },
  {
    label: "Library",
    items: [
      NAV_SECTIONS.find((s) => s.label === "Updates")!.items.find(
        (i) => !isSubheading(i) && i.mode === "whatsnew",
      )!,
      NAV_SECTIONS.find((s) => s.label === "Design")!.items.find(
        (i) => !isSubheading(i) && i.mode === "refarch",
      )!,
      NAV_SECTIONS.find((s) => s.label === "Design")!.items.find(
        (i) => !isSubheading(i) && i.mode === "showcase",
      )!,
    ],
  },
];

// Optional "Skills" section, surfaced only when the CUSTOM_SKILLS flag is on.
// Present in both the legacy and unified surfaces.
const SKILLS_SECTION: NavSectionDef = {
  label: "Skills",
  items: [
    { mode: "skills", label: "My Skills", icon: <PuzzlePieceRegular />, description: "Upload, enable, and run your own skills" },
    { mode: "skill-showcase", label: "Skill Showcase", icon: <PlugConnectedRegular />, description: "Browse and install community skills" },
  ],
};

const useStyles = makeStyles({
  nav: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: tokens.colorNeutralBackground1,
    borderRight: "1px solid rgba(255,255,255,0.05)",
    overflow: "hidden",
    transition: "width 0.2s ease",
    flexShrink: 0,
  },
  collapseBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: "10px 8px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    height: "56px",
    flexShrink: 0,
  },
  sections: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "4px 0 16px",
  },
  sectionLabel: {
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: tokens.colorNeutralForeground4,
    padding: "14px 16px 4px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    cursor: "pointer",
    ":hover": {
      color: tokens.colorNeutralForeground3,
    },
  },
  sectionChevron: {
    fontSize: "10px",
    flexShrink: 0,
    transition: "transform 0.15s ease",
  },
  sectionDivider: {
    height: "1px",
    background: "rgba(255,255,255,0.04)",
    margin: "6px 12px 0",
  },
  subheading: {
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: tokens.colorNeutralForeground4,
    padding: "10px 16px 2px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    userSelect: "none",
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "7px 12px 7px 13px",
    margin: "1px 6px",
    borderRadius: "6px",
    cursor: "pointer",
    userSelect: "none",
    transition: "background 0.12s, box-shadow 0.12s",
    borderLeft: "3px solid transparent",
    "&:hover": {
      background: "rgba(0, 120, 212, 0.08)",
    },
  },
  navItemActive: {
    background: "rgba(0, 120, 212, 0.12)",
    borderLeftColor: "#0078D4",
    boxShadow: "inset 3px 0 0 #0078D4",
    paddingLeft: "10px",
    "&:hover": {
      background: "rgba(0, 120, 212, 0.18)",
    },
  },
  navItemCollapsed: {
    justifyContent: "center",
    padding: "8px",
    paddingLeft: "8px",
  },
  navItemCollapsedActive: {
    background: "rgba(0, 120, 212, 0.12)",
    borderLeftColor: "#0078D4",
    boxShadow: "inset 3px 0 0 #0078D4",
  },
  navItemIcon: {
    flexShrink: 0,
    fontSize: "17px",
    color: tokens.colorNeutralForeground3,
    display: "flex",
    alignItems: "center",
    transition: "transform 0.12s, color 0.12s",
    "&:hover": {
      transform: "scale(1.08)",
    },
  },
  navItemIconActive: {
    color: "#0078D4",
    filter: "drop-shadow(0 0 4px rgba(0,120,212,0.4))",
  },
  navItemLabel: {
    fontSize: "13px",
    fontWeight: 400,
    color: tokens.colorNeutralForeground2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  navItemLabelActive: {
    color: tokens.colorNeutralForeground1,
    fontWeight: 600,
  },
  alertDot: {
    position: "absolute",
    top: "-2px",
    right: "-3px",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "#C50F1F",
    border: "1px solid rgba(0,0,0,0.4)",
    boxShadow: "0 0 6px rgba(197,15,31,0.7)",
    flexShrink: 0,
  },
  navItemIconWrap: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
});

interface SideNavProps {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  badgeCounts?: Partial<Record<Mode, number>>;
  favorites?: Mode[];
  onToggleFavorite?: (mode: Mode) => void;
}

// Map from mode to its icon for pinned favorites rendering
const MODE_ICON_MAP: Partial<Record<Mode, JSX.Element>> = {
  qa: <ChatRegular />, architecture: <BuildingRegular />, waf: <ShieldCheckmarkRegular />,
  review: <ClipboardTaskRegular />, drbc: <ArrowSyncRegular />, codegen: <CodeRegular />,
  learningplan: <BoardRegular />, intake: <FormRegular />, analyze: <ChartMultipleRegular />,
  landingzone: <LayerRegular />, threatmodel: <ShieldErrorRegular />, reliability: <HeartPulseRegular />,
  troubleshoot: <WrenchScrewdriverRegular />, whatsnew: <MegaphoneLoudRegular />,
  strategy: <TargetRegular />, "cost-optimize": <DataUsageRegular />, "pricing-desk": <MoneyCalculatorRegular />, pipelineforge: <BranchForkRegular />,
  runbookstudio: <DocumentBulletListRegular />, namingstandards: <TagRegular />,
  "demo-build": <RocketRegular />, showcase: <PlayCircleRegular />, refarch: <BookRegular />,
  netvnet: <GlobeRegular />, compsku: <ServerRegular />, aifoundry: <SparkleRegular />,
  datalake: <DataBarVerticalRegular />, presentation: <SlideTextRegular />,
  servicehealth: <HeartPulseRegular />, modellifecycle: <CalendarRegular />,
  modelmigration: <ArrowSwapRegular />, network: <GlobeRegular />,
  cost: <DataUsageRegular />, compliance: <ShieldCheckmarkRegular />,
  architect: <BuildingRegular />, operations: <WrenchScrewdriverRegular />,
  engagement: <FormRegular />,
  skills: <PuzzlePieceRegular />, "skill-showcase": <PlugConnectedRegular />,
};

const MODE_LABEL_MAP: Partial<Record<Mode, string>> = {
  qa: "Expert Advisor", architecture: "Architecture Design", waf: "WAF Assessment",
  review: "Architecture Review", drbc: "DR/BC Design", codegen: "Code Generator",
  learningplan: "Learning Plan", intake: "Requirements Studio", analyze: "Workload Analysis",
  landingzone: "Landing Zone", threatmodel: "Threat Model", reliability: "Reliability & SLO",
  troubleshoot: "Troubleshoot", whatsnew: "What's New", strategy: "Strategy Builder",
  "cost-optimize": "Cost Optimize", pipelineforge: "Pipeline Forge", runbookstudio: "Runbook Studio",
  namingstandards: "Naming Standards", "demo-build": "Demo Builder", showcase: "Demo Showcase",
  refarch: "Reference Architectures", netvnet: "Network Desk", compsku: "Compute Desk",
  aifoundry: "AI Desk", datalake: "Data Desk", presentation: "Presentation Coach",
  servicehealth: "Service Health", modellifecycle: "Model Lifecycle", modelmigration: "Model IQ",
  network: "Network Design", cost: "Cost & FinOps", compliance: "Compliance & Security",
  architect: "Architect", operations: "Operations", engagement: "Engagement Hub",
  skills: "My Skills", "skill-showcase": "Skill Showcase",
};

export default function SideNav({ mode, onModeChange, collapsed, onToggleCollapsed, badgeCounts = {}, favorites = [], onToggleFavorite }: SideNavProps) {
  const styles = useStyles();
  const { roles } = useAuth();
  const isMetricsAdmin = roles.includes("Metrics.Read");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(NAV_SECTIONS.map((s) => s.label).filter((l) => l !== "Agents"))
  );

  function toggleSection(label: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <nav className={styles.nav} style={{ width: collapsed ? 48 : 224 }}>
      <div className={styles.collapseBtn}>
        <Button
          appearance="subtle"
          size="small"
          icon={collapsed ? <ChevronRightRegular /> : <ChevronLeftRegular />}
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
        />
      </div>

      <div className={styles.sections}>
        {/* Favorites / Pinned Modes */}
        {favorites.length > 0 && (
          <div>
            {!collapsed && <div className={styles.sectionLabel} style={{ cursor: "default" }}>Favorites</div>}
            {favorites.map((fav) => {
              const isActive = mode === fav;
              const icon = MODE_ICON_MAP[fav] ?? <PinRegular />;
              const label = MODE_LABEL_MAP[fav] ?? fav;
              const itemEl = (
                <div
                  key={fav}
                  className={
                    collapsed
                      ? `${styles.navItem} ${styles.navItemCollapsed} ${isActive ? styles.navItemCollapsedActive : ""}`
                      : `${styles.navItem} ${isActive ? styles.navItemActive : ""}`
                  }
                  onClick={() => onModeChange(fav)}
                >
                  <span className={styles.navItemIconWrap}>
                    <span className={`${styles.navItemIcon} ${isActive ? styles.navItemIconActive : ""}`}>
                      {icon}
                    </span>
                  </span>
                  {!collapsed && (
                    <>
                      <Text className={`${styles.navItemLabel} ${isActive ? styles.navItemLabelActive : ""}`}>
                        {label}
                      </Text>
                      <span style={{ marginLeft: "auto", display: "flex" }} onClick={(e) => e.stopPropagation()}>
                        <NavItemHowTo mode={fav} />
                      </span>
                      {onToggleFavorite && (
                        <StarFilled
                          style={{ fontSize: "12px", color: "#FFB900", cursor: "pointer", flexShrink: 0 }}
                          onClick={(e) => { e.stopPropagation(); onToggleFavorite(fav); }}
                        />
                      )}
                    </>
                  )}
                </div>
              );
              return collapsed ? (
                <Tooltip key={fav} content={`${label} (Pinned)`} relationship="label" positioning="after">
                  {itemEl}
                </Tooltip>
              ) : itemEl;
            })}
            {!collapsed && <div className={styles.sectionDivider} />}
          </div>
        )}

        {(() => {
          const baseSections = unifiedAgentsEnabled()
            ? UNIFIED_NAV_SECTIONS
            : NAV_SECTIONS.filter((s) => s.label !== "Agents");
          const sections = getCustomSkills() ? [...baseSections, SKILLS_SECTION] : baseSections;
          return sections;
        })().map((section, si) => {
          const isSectionCollapsed = collapsedSections.has(section.label);
          return (
            <div key={section.label}>
              {si > 0 && !collapsed && <div className={styles.sectionDivider} />}
              {!collapsed && (
                <div className={styles.sectionLabel} onClick={() => toggleSection(section.label)}>
                  {section.label}
                  <ChevronDownRegular
                    className={styles.sectionChevron}
                    style={{ transform: isSectionCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                  />
                </div>
              )}

              {!isSectionCollapsed && section.items.map((item) => {
              if (isSubheading(item)) {
                if (collapsed) return null;
                return (
                  <div key={`sub-${section.label}-${item.subheading}`} className={styles.subheading}>
                    {item.subheading}
                  </div>
                );
              }
              const isActive = item.activeWhen ? item.activeWhen.includes(mode) : mode === item.mode;
              const alertCount = badgeCounts[item.mode] ?? 0;
              const itemEl = (
                <div
                  key={item.mode}
                  className={
                    collapsed
                      ? `${styles.navItem} ${styles.navItemCollapsed} ${isActive ? styles.navItemCollapsedActive : ""}`
                      : `${styles.navItem} ${isActive ? styles.navItemActive : ""}`
                  }
                  onClick={() => onModeChange(item.mode)}
                >
                  <span className={styles.navItemIconWrap}>
                    <span className={`${styles.navItemIcon} ${isActive ? styles.navItemIconActive : ""}`}>
                      {item.icon}
                    </span>
                    {alertCount > 0 && <span className={styles.alertDot} />}
                  </span>
                  {!collapsed && (
                    <Text className={`${styles.navItemLabel} ${isActive ? styles.navItemLabelActive : ""}`}>
                      {item.label}
                    </Text>
                  )}
                  {!collapsed && (
                    <span style={{ marginLeft: "auto", display: "flex" }} onClick={(e) => e.stopPropagation()}>
                      <NavItemHowTo mode={item.mode} />
                    </span>
                  )}
                  {!collapsed && onToggleFavorite && (
                    <span
                      style={{ fontSize: "12px", cursor: "pointer", flexShrink: 0, opacity: favorites.includes(item.mode) ? 1 : 0, transition: "opacity 0.15s" }}
                      onClick={(e) => { e.stopPropagation(); onToggleFavorite(item.mode); }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = favorites.includes(item.mode) ? "1" : "0"; }}
                    >
                      {favorites.includes(item.mode)
                        ? <StarFilled style={{ color: "#FFB900" }} />
                        : <StarRegular style={{ color: tokens.colorNeutralForeground4 }} />
                      }
                    </span>
                  )}
                </div>
              );

              return collapsed ? (
                <Tooltip key={item.mode} content={alertCount > 0 ? `${item.label} — ${alertCount} active incident${alertCount !== 1 ? "s" : ""}` : `${item.label} — ${item.description}`} relationship="label" positioning="after">
                  {itemEl}
                </Tooltip>
              ) : itemEl;
            })}
          </div>
        );
      })}

        {isMetricsAdmin && (
          <div>
            <div className={styles.sectionDivider} />
            {!collapsed && <div className={styles.sectionLabel}>Admin</div>}
            {(() => {
              const isActive = mode === "admin";
              const itemEl = (
                <div
                  className={
                    collapsed
                      ? `${styles.navItem} ${styles.navItemCollapsed} ${isActive ? styles.navItemCollapsedActive : ""}`
                      : `${styles.navItem} ${isActive ? styles.navItemActive : ""}`
                  }
                  onClick={() => onModeChange("admin")}
                >
                  <span className={styles.navItemIconWrap}>
                    <span className={`${styles.navItemIcon} ${isActive ? styles.navItemIconActive : ""}`}>
                      <DataUsageRegular />
                    </span>
                  </span>
                  {!collapsed && (
                    <Text className={`${styles.navItemLabel} ${isActive ? styles.navItemLabelActive : ""}`}>
                      Usage Metrics
                    </Text>
                  )}
                </div>
              );
              return collapsed ? (
                <Tooltip content="Usage Metrics — View KPIs and user activity" relationship="label" positioning="after">
                  {itemEl}
                </Tooltip>
              ) : itemEl;
            })()}
          </div>
        )}
      </div>
    </nav>
  );
}
