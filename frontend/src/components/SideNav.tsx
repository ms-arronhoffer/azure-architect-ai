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
  BranchForkRegular,
  DocumentBulletListRegular,
  TagRegular,
  DocumentRegular,
  DatabaseRegular,
  ScalesRegular,
  PlugConnectedRegular,
  TableRegular,
  PlayCircleRegular,
  GlobeRegular,
} from "@fluentui/react-icons";
import type { Mode } from "../types";
import { useAuth } from "../auth/AuthProvider";

interface NavItemDef {
  mode: Mode;
  label: string;
  icon: JSX.Element;
  description: string;
  activeWhen?: Mode[];
}

interface NavSectionDef {
  label: string;
  items: NavItemDef[];
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

const NAV_SECTIONS: NavSectionDef[] = [
  {
    label: "Communications",
    items: [
      { mode: "whatsnew", label: "What's New", icon: <MegaphoneLoudRegular />, description: "Microsoft announcements & draft customer emails" },
      { mode: "servicehealth", label: "Service Health", icon: <HeartPulseRegular />, description: "Azure service incidents and health advisories" },
      { mode: "modellifecycle", label: "Model Lifecycle", icon: <CalendarRegular />, description: "Azure Foundry model retirement schedule" },
      { mode: "modelmigration", label: "Migration Advisor", icon: <ArrowSwapRegular />, description: "Score model migrations and plan PTU capacity" },
      { mode: "showcase", label: "Demo Showcase", icon: <PlayCircleRegular />, description: "Browse and contribute to the demo catalog" },
    ],
  },
  {
    label: "Advisory",
    items: [
      { mode: "intake", label: "Requirements Studio", icon: <FormRegular />, description: "Capture workload requirements — injected everywhere" },
      { mode: "analyze", label: "Workload Analysis", icon: <ChartMultipleRegular />, description: "Architecture + WAF + Security in one click" },
      { mode: "qa", label: "Expert Advisor", icon: <ChatRegular />, description: "17 specialist advisor personas", activeWhen: ADVISOR_MODES },
      { mode: "presentation", label: "Presentation Coach", icon: <SlideTextRegular />, description: "Structure Azure topics for any audience" },
      { mode: "learningplan", label: "Learning Plan", icon: <BoardRegular />, description: "Build structured training plans with outcomes" },
      { mode: "rfpproposal", label: "RFP / Proposal Writer", icon: <DocumentRegular />, description: "Azure technical proposals and statements of work" },
    ],
  },
  {
    label: "Design & Build",
    items: [
      { mode: "architecture", label: "Architecture Design", icon: <BuildingRegular />, description: "Architecture, Network, AI, Data Platform, APIM", activeWhen: ARCH_MODES },
      { mode: "strategy", label: "Strategy Builder", icon: <TargetRegular />, description: "AI-generated Azure strategy document" },
      { mode: "bootstrap", label: "Bootstrapper", icon: <RocketRegular />, description: "4-step guided wizard with ZIP download" },
      { mode: "landingzone", label: "Landing Zone", icon: <LayerRegular />, description: "Azure CAF landing zone design with management groups" },
      { mode: "pipelineforge", label: "Pipeline Forge", icon: <BranchForkRegular />, description: "Generate GitHub Actions & Azure DevOps CI/CD pipelines" },
      { mode: "namingstandards", label: "Naming Standards", icon: <TagRegular />, description: "CAF naming conventions + Bicep/Terraform enforcement module" },
    ],
  },
  {
    label: "Networking",
    items: [
      { mode: "netvnet", label: "Network Desk", icon: <GlobeRegular />, description: "11 specialist advisors for Azure networking", activeWhen: NETWORK_DESK_MODES },
    ],
  },
  {
    label: "Assessment",
    items: [
      { mode: "waf", label: "WAF Assessment", icon: <ShieldCheckmarkRegular />, description: "Score all 5 WAF pillars" },
      { mode: "review", label: "Architecture Review", icon: <ClipboardTaskRegular />, description: "Red team your architecture for gaps" },
      { mode: "threatmodel", label: "Threat Model", icon: <ShieldErrorRegular />, description: "STRIDE analysis, attack surface & security controls" },
    ],
  },
  {
    label: "Operations",
    items: [
      { mode: "drbc", label: "DR/BC Design", icon: <ArrowSyncRegular />, description: "Recovery strategies and failover runbooks" },
      { mode: "reliability", label: "Reliability & SLO", icon: <HeartPulseRegular />, description: "SLO design, FMEA, chaos experiments & toil inventory" },
      { mode: "troubleshoot", label: "Troubleshoot", icon: <WrenchScrewdriverRegular />, description: "Diagnose and resolve Azure issues" },
      { mode: "codegen", label: "Code Generator", icon: <CodeRegular />, description: "Generate code with Copilot and push to GitHub" },
      { mode: "runbookstudio", label: "Runbook Studio", icon: <DocumentBulletListRegular />, description: "Generate SRE runbooks for Azure failure scenarios" },
    ],
  },
  {
    label: "Data Engineering",
    items: [
      { mode: "datapipelineadvisor", label: "Pipeline Advisor", icon: <DatabaseRegular />, description: "Debug ADF, Fabric, Spark, and Synapse pipeline issues" },
      { mode: "fabricplanner", label: "Fabric Capacity Planner", icon: <ScalesRegular />, description: "Right-size Microsoft Fabric F-SKU for your workload" },
      { mode: "adfpipeline", label: "ADF Pipeline Generator", icon: <PlugConnectedRegular />, description: "Generate deployable ADF ARM templates from plain English" },
      { mode: "medalliondesigner", label: "Medallion Designer", icon: <TableRegular />, description: "Design Bronze/Silver/Gold Delta Lake schemas from source DDL" },
    ],
  },
];

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
}

export default function SideNav({ mode, onModeChange, collapsed, onToggleCollapsed, badgeCounts = {} }: SideNavProps) {
  const styles = useStyles();
  const { roles } = useAuth();
  const isMetricsAdmin = roles.includes("Metrics.Read");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(NAV_SECTIONS.map((s) => s.label))
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
        {NAV_SECTIONS.map((section, si) => {
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
