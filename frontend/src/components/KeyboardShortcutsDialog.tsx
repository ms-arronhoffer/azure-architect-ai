import {
  makeStyles,
  tokens,
  Button,
  Text,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";

const SHORTCUTS: Array<{ keys: string; description: string; section: string }> = [
  { keys: "Ctrl + K", description: "Open command palette", section: "Navigation" },
  { keys: "Ctrl + /", description: "Show keyboard shortcuts", section: "Navigation" },
  { keys: "Ctrl + H", description: "Open history drawer", section: "Navigation" },
  { keys: "Ctrl + Shift + N", description: "New conversation", section: "Navigation" },
  { keys: "Ctrl + Shift + D", description: "Toggle dark mode", section: "Appearance" },
  { keys: "Ctrl + Shift + T", description: "Toggle telemetry debug drawer", section: "Debug" },
];

const useStyles = makeStyles({
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.5)",
    backdropFilter: "blur(4px)",
    zIndex: 9999,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  dialog: {
    width: "420px",
    background: tokens.colorNeutralBackground1,
    borderRadius: "12px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  title: {
    fontSize: "16px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  body: {
    padding: "12px 20px 20px",
  },
  sectionLabel: {
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: tokens.colorNeutralForeground4,
    padding: "10px 0 4px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 0",
  },
  description: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
  },
  keys: {
    fontSize: "12px",
    fontFamily: "monospace",
    color: tokens.colorNeutralForeground1,
    background: tokens.colorNeutralBackground3,
    padding: "2px 8px",
    borderRadius: "4px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: "nowrap",
  },
});

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  const styles = useStyles();

  if (!open) return null;

  const sections = [...new Set(SHORTCUTS.map((s) => s.section))];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Keyboard Shortcuts</span>
          <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onClose} />
        </div>
        <div className={styles.body}>
          {sections.map((section) => (
            <div key={section}>
              <div className={styles.sectionLabel}>{section}</div>
              {SHORTCUTS.filter((s) => s.section === section).map((shortcut) => (
                <div key={shortcut.keys} className={styles.row}>
                  <Text className={styles.description}>{shortcut.description}</Text>
                  <span className={styles.keys}>{shortcut.keys}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
