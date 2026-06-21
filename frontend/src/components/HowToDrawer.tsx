import {
  makeStyles,
  tokens,
  Button,
  Text,
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { HOW_TO_SECTIONS, HOW_TO } from "../constants/howTo";

const useStyles = makeStyles({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    padding: "16px 20px 32px",
    overflowY: "auto",
  },
  intro: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.5",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  sectionTitle: {
    fontWeight: 700,
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: tokens.colorNeutralForeground3,
    paddingBottom: "4px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px 14px",
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
  },
  cardTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  what: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.5",
  },
  subhead: {
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: tokens.colorNeutralForeground3,
    marginTop: "4px",
  },
  list: {
    margin: 0,
    paddingLeft: "20px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.5",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
});

interface HowToDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function HowToDrawer({ open, onClose }: HowToDrawerProps) {
  const styles = useStyles();

  return (
    <Drawer
      open={open}
      onOpenChange={(_, d) => { if (!d.open) onClose(); }}
      position="end"
      size="medium"
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onClose} />
          }
        >
          How to use Azure Architect AI
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <div className={styles.body}>
          <Text className={styles.intro}>
            Each entry below corresponds to a tab in the left navigation. Pick a
            tab to see what it does, how to drive it, and what artifacts you
            should expect to walk away with.
          </Text>
          {HOW_TO_SECTIONS.map((section) => (
            <div key={section.label} className={styles.section}>
              <Text className={styles.sectionTitle}>{section.label}</Text>
              {section.modes.map((mode) => {
                const entry = HOW_TO[mode];
                if (!entry) return null;
                return (
                  <div key={mode} className={styles.card}>
                    <Text className={styles.cardTitle}>{entry.label}</Text>
                    <Text className={styles.what}>{entry.whatItDoes}</Text>
                    {entry.howToUse.length > 0 && (
                      <>
                        <Text className={styles.subhead}>How to use</Text>
                        <ol className={styles.list}>
                          {entry.howToUse.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </>
                    )}
                    {entry.outputs.length > 0 && (
                      <>
                        <Text className={styles.subhead}>Outputs</Text>
                        <ul className={styles.list}>
                          {entry.outputs.map((out, i) => (
                            <li key={i}>{out}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </DrawerBody>
    </Drawer>
  );
}
