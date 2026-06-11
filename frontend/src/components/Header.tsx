import {
  makeStyles,
  tokens,
  Button,
  Text,
} from "@fluentui/react-components";
import {
  WeatherMoonRegular,
  WeatherSunnyRegular,
  HistoryRegular,
  AppsRegular,
  SettingsRegular,
  GlobeRegular,
  SignOutRegular,
} from "@fluentui/react-icons";
import type { Mode } from "../types";
import { useAuth } from "../auth/AuthProvider";

const MODE_LABELS: Record<Mode, string> = {
  qa: "Expert Q&A",
  architecture: "Architecture Design",
  reference: "Reference Library",
  compare: "Service Comparison",
  waf: "WAF Assessment",
  review: "Architecture Review",
  compliance: "Compliance Mapping",
  migration: "Migration Assessment",
  regional: "Regional Advisor",
  cost: "Cost Optimization",
  drbc: "DR/BC Design",
  monitoring: "Monitoring Config",
  situation: "Situation Advisor",
  presentation: "Presentation Coach",
  certprep: "Cert Prep",
  learningplan: "Learning Plan",
  codegen: "Code Generator",
  tco: "TCO Analysis",
  bootstrap: "Bootstrapper",
  aiarchitecture: "AI Architecture",
  dataplatform: "Data Platform",
  apim: "API Management",
  network: "Network Design",
  landingzone: "Landing Zone",
  identity: "Identity & Access",
  threatmodel: "Threat Modeling",
  devsecops: "DevSecOps",
  reliability: "Reliability & SLO",
  troubleshoot: "Troubleshoot",
  sizing: "Capacity Sizing",
  security: "Security & Identity",
  governance: "Governance",
  ops: "Observability & SRE",
  intake: "Requirements Studio",
  analyze: "Workload Analysis",
  whatsnew: "What's New",
  servicehealth: "Service Health",
  strategy: "Strategy Builder",
  admin: "Usage Metrics",
};

const MODE_SECTION: Partial<Record<Mode, string>> = {
  intake: "Advisory",
  analyze: "Advisory",
  qa: "Advisory",
  situation: "Advisory",
  presentation: "Advisory",
  certprep: "Advisory",
  learningplan: "Advisory",
  regional: "Advisory",
  architecture: "Design & Build",
  reference: "Design & Build",
  compare: "Design & Build",
  bootstrap: "Design & Build",
  network: "Design & Build",
  aiarchitecture: "Design & Build",
  landingzone: "Platform & Governance",
  identity: "Platform & Governance",
  devsecops: "Platform & Governance",
  apim: "Platform & Governance",
  waf: "Assessment",
  review: "Assessment",
  compliance: "Assessment",
  migration: "Assessment",
  threatmodel: "Assessment",
  reliability: "Assessment",
  cost: "Operations",
  monitoring: "Operations",
  drbc: "Operations",
  codegen: "Operations",
  tco: "Operations",
  sizing: "Operations",
  dataplatform: "Operations",
  whatsnew: "Communications",
  servicehealth: "Communications",
  strategy: "Design & Build",
};

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    padding: "0 20px",
    height: "56px",
    flexShrink: 0,
    background: "var(--gradient-header)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    boxShadow: "0 1px 0 rgba(0,120,212,0.35)",
    gap: "14px",
    position: "relative",
    zIndex: 10,
  },
  accentLine: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "2px",
    background: "var(--gradient-accent)",
    opacity: 0.9,
    pointerEvents: "none",
  },
  brandIcon: {
    color: "#0078D4",
    fontSize: "20px",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    filter: "drop-shadow(0 0 6px rgba(0,120,212,0.5))",
  },
  brand: {
    fontWeight: 700,
    fontSize: "15px",
    letterSpacing: "-0.2px",
    background: "var(--gradient-azure)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    whiteSpace: "nowrap",
    userSelect: "none",
    flexShrink: 0,
  },
  divider: {
    width: "1px",
    height: "18px",
    background: "rgba(255,255,255,0.1)",
    flexShrink: 0,
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    overflow: "hidden",
    flex: 1,
    minWidth: 0,
  },
  section: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  chevron: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
    flexShrink: 0,
  },
  modeLabel: {
    fontSize: "13px",
    fontWeight: 500,
    color: tokens.colorNeutralForeground1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    display: "flex",
    gap: "2px",
    alignItems: "center",
    flexShrink: 0,
  },
  userName: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    paddingRight: "4px",
    whiteSpace: "nowrap",
  },
});

interface HeaderProps {
  mode: Mode;
  darkMode: boolean;
  onToggleDark: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenContext: () => void;
}

export default function Header({ mode, darkMode, onToggleDark, onOpenHistory, onOpenSettings, onOpenContext }: HeaderProps) {
  const styles = useStyles();
  const section = MODE_SECTION[mode];
  const { account, logout, enabled: authEnabled } = useAuth();
  const firstName = account?.name?.split(" ")[0] ?? account?.username?.split("@")[0] ?? null;

  return (
    <header className={styles.header}>
      <div className={styles.accentLine} />
      <span className={styles.brandIcon}><AppsRegular /></span>
      <span className={styles.brand}>Azure Architect AI</span>
      <div className={styles.divider} />
      <div className={styles.breadcrumb}>
        {section && <Text className={styles.section}>{section}</Text>}
        {section && <span className={styles.chevron}>›</span>}
        <Text className={styles.modeLabel}>{MODE_LABELS[mode]}</Text>
      </div>
      <div className={styles.actions}>
        {authEnabled && firstName && (
          <>
            <Text className={styles.userName}>{firstName}</Text>
            <Button
              appearance="subtle"
              size="small"
              icon={<SignOutRegular />}
              onClick={logout}
              title="Sign out"
            />
          </>
        )}
        <Button
          appearance="subtle"
          size="small"
          icon={<GlobeRegular />}
          onClick={onOpenContext}
          title="Workload context"
        />
        <Button
          appearance="subtle"
          size="small"
          icon={<HistoryRegular />}
          onClick={onOpenHistory}
          title="Conversation history"
        />
        <Button
          appearance="subtle"
          size="small"
          icon={<SettingsRegular />}
          onClick={onOpenSettings}
          title="Settings"
        />
        <Button
          appearance="subtle"
          size="small"
          icon={darkMode ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
          onClick={onToggleDark}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        />
      </div>
    </header>
  );
}
