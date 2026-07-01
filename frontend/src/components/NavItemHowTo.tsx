import {
  makeStyles,
  tokens,
  Text,
  Popover,
  PopoverTrigger,
  PopoverSurface,
} from "@fluentui/react-components";
import { QuestionCircleRegular } from "@fluentui/react-icons";
import type { Mode } from "../types";
import { HOW_TO } from "../constants/howTo";

const useStyles = makeStyles({
  trigger: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground4,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    "&:hover": {
      color: "#0078D4",
    },
  },
  surface: {
    maxWidth: "320px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "14px 16px",
  },
  title: {
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
    paddingLeft: "18px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.5",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
});

interface NavItemHowToProps {
  mode: Mode;
}

/**
 * A small "?" affordance rendered inside a SideNav item. Clicking it pops out a
 * focused how-to for that specific tool — what it does, how to drive it, and
 * what to expect — sourced from the shared HOW_TO map. Returns null for modes
 * that have no how-to entry so the nav stays clean.
 */
export default function NavItemHowTo({ mode }: NavItemHowToProps) {
  const styles = useStyles();
  const entry = HOW_TO[mode];
  if (!entry) return null;

  return (
    <Popover withArrow positioning="after" size="small">
      <PopoverTrigger disableButtonEnhancement>
        <span
          className={styles.trigger}
          role="button"
          tabIndex={0}
          aria-label={`How to use ${entry.label}`}
          title={`How to use ${entry.label}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
          }}
        >
          <QuestionCircleRegular />
        </span>
      </PopoverTrigger>
      <PopoverSurface aria-label={`How to use ${entry.label}`}>
        <div className={styles.surface} onClick={(e) => e.stopPropagation()}>
          <Text className={styles.title}>{entry.label}</Text>
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
              <Text className={styles.subhead}>What to expect</Text>
              <ul className={styles.list}>
                {entry.outputs.map((out, i) => (
                  <li key={i}>{out}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </PopoverSurface>
    </Popover>
  );
}
