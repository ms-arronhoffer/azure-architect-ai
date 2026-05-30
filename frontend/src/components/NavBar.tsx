import { JSX } from "react";
import {
  makeStyles,
  TabList,
  Tab,
  tokens,
  Button,
  Text,
} from "@fluentui/react-components";
import {
  ChatRegular,
  ArchiveRegular,
  ShieldCheckmarkRegular,
  PersonChatRegular,
  SlideTextRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
} from "@fluentui/react-icons";
import type { Mode } from "../types";

const useStyles = makeStyles({
  nav: {
    display: "flex",
    alignItems: "center",
    padding: "8px 16px",
    background: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    gap: "16px",
  },
  brand: {
    fontWeight: 700,
    fontSize: "16px",
    color: tokens.colorBrandForeground1,
    whiteSpace: "nowrap",
    marginRight: "8px",
  },
  tabs: { flex: 1 },
});

interface NavBarProps {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  darkMode: boolean;
  onToggleDark: () => void;
}

const TABS: { value: Mode; label: string; icon: JSX.Element }[] = [
  { value: "qa", label: "Expert Q&A", icon: <ChatRegular /> },
  { value: "architecture", label: "Architecture Design", icon: <ArchiveRegular /> },
  { value: "waf", label: "WAF Assessment", icon: <ShieldCheckmarkRegular /> },
  { value: "situation", label: "Situation Advisor", icon: <PersonChatRegular /> },
  { value: "presentation", label: "Presentation Coach", icon: <SlideTextRegular /> },
];

export default function NavBar({ mode, onModeChange, darkMode, onToggleDark }: NavBarProps) {
  const styles = useStyles();
  return (
    <nav className={styles.nav}>
      <Text className={styles.brand}>Azure Architect AI</Text>
      <TabList
        className={styles.tabs}
        selectedValue={mode}
        onTabSelect={(_, d) => onModeChange(d.value as Mode)}
        size="small"
      >
        {TABS.map((t) => (
          <Tab key={t.value} value={t.value} icon={t.icon}>
            {t.label}
          </Tab>
        ))}
      </TabList>
      <Button
        appearance="subtle"
        icon={darkMode ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
        onClick={onToggleDark}
        title="Toggle theme"
      />
    </nav>
  );
}
