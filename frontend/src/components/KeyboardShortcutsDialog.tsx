import { useEffect } from "react";
import { makeStyles, tokens, Text, Button } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9998,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.5)",
    backdropFilter: "blur(2px)",
  },
  dialog: {
    width: "420px",
    maxHeight: "520px",
    display: "flex",
    flexDirection: "column",
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "12px",
    boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
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
    flex: 1,
    overflowY: "auto",
    padding: "12px 20px 20px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  sectionTitle: {
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: tokens.colorNeutralForeground4,
    paddingBottom: "4px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 0",
  },
  label: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
  },
  keys: {
    display: "flex",
    gap: "4px",
  },
  kbd: {
    display: "inline-block",
    padding: "2px 7px",
    fontSize: "11px",
    fontWeight: 600,
    fontFamily: "monospace",
    color: tokens.colorNeutralForeground2,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "4px",
    lineHeight: "18px",
  },
});

interface ShortcutRow {
  label: string;
  keys: string[];
}

interface ShortcutSection {
  title: string;
  items: ShortcutRow[];
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: "Navigation",
    items: [
      { label: "Command palette (search modes)", keys: ["Ctrl", "K"] },
      { label: "Open conversation history", keys: ["Ctrl", "H"] },
      { label: "Toggle dark/light mode", keys: ["Ctrl", "Shift", "D"] },
      { label: "Toggle telemetry debug drawer", keys: ["Ctrl", "Shift", "T"] },
    ],
  },
  {
    title: "Chat",
    items: [
      { label: "Send message", keys: ["Enter"] },
      { label: "New line in message", keys: ["Shift", "Enter"] },
      { label: "New conversation", keys: ["Ctrl", "Shift", "N"] },
    ],
  },
  {
    title: "General",
    items: [
      { label: "Show keyboard shortcuts", keys: ["Ctrl", "/"] },
      { label: "Close dialogs / drawers", keys: ["Esc"] },
    ],
  },
];

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  const styles = useStyles();

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <Text className={styles.title}>Keyboard Shortcuts</Text>
          <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onClose} />
        </div>
        <div className={styles.body}>
          {SHORTCUT_SECTIONS.map((section) => (
            <div key={section.title} className={styles.section}>
              <Text className={styles.sectionTitle}>{section.title}</Text>
              {section.items.map((item) => (
                <div key={item.label} className={styles.row}>
                  <Text className={styles.label}>{item.label}</Text>
                  <span className={styles.keys}>
                    {item.keys.map((k, i) => (
                      <span key={i}>
                        <kbd className={styles.kbd}>{k}</kbd>
                        {i < item.keys.length - 1 && <span style={{ color: tokens.colorNeutralForeground4, margin: "0 2px" }}>+</span>}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
