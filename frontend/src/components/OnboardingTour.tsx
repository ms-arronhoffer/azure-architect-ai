import { useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
} from "@fluentui/react-components";
import { DismissRegular, ChevronRightRegular, ChevronLeftRegular } from "@fluentui/react-icons";

const TOUR_SEEN_KEY = "azure_onboarding_seen";

const STEPS = [
  {
    title: "Welcome to Azure Architect AI",
    body: "Your virtual Azure Solutions Architect with 84+ specialized tools for designing, assessing, and building cloud solutions.",
  },
  {
    title: "Side Navigation",
    body: "Browse modes organized by category: Advise, Plan, Design, Assess, and Build & Run. Click any section header to expand or collapse it.",
  },
  {
    title: "Command Palette (Ctrl+K)",
    body: "Press Ctrl+K to quickly search and switch between any of the 84+ modes without scrolling. Pin your favorites for even faster access.",
  },
  {
    title: "Workload Context",
    body: "Set your region, compliance framework, and budget once — every mode inherits this context for more accurate recommendations.",
  },
  {
    title: "Conversation History (Ctrl+H)",
    body: "All your sessions are saved automatically. Search across conversation titles and message content to find past decisions.",
  },
  {
    title: "Keyboard Shortcuts (Ctrl+/)",
    body: "Press Ctrl+/ anytime to see all available keyboard shortcuts. Use Ctrl+Shift+D for dark mode and Ctrl+Shift+N for a new conversation.",
  },
];

const useStyles = makeStyles({
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(6px)",
    zIndex: 10000,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "480px",
    background: tokens.colorNeutralBackground1,
    borderRadius: "16px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: "0 32px 64px rgba(0,0,0,0.5)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 24px 0",
  },
  stepIndicator: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
  },
  body: {
    padding: "20px 24px 24px",
  },
  title: {
    fontSize: "18px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    marginBottom: "12px",
    display: "block",
  },
  description: {
    fontSize: "14px",
    lineHeight: "22px",
    color: tokens.colorNeutralForeground2,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 24px 20px",
  },
  dots: {
    display: "flex",
    gap: "6px",
  },
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: tokens.colorNeutralForeground4,
    transition: "background 0.2s, transform 0.2s",
  },
  dotActive: {
    background: "#0078D4",
    transform: "scale(1.3)",
  },
  navButtons: {
    display: "flex",
    gap: "8px",
  },
});

interface OnboardingTourProps {
  onClose: () => void;
}

export function shouldShowOnboarding(): boolean {
  try {
    return !localStorage.getItem(TOUR_SEEN_KEY);
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch { /* ignore */ }
}

export default function OnboardingTour({ onClose }: OnboardingTourProps) {
  const styles = useStyles();
  const [step, setStep] = useState(0);

  function handleFinish() {
    markOnboardingSeen();
    onClose();
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.stepIndicator}>Step {step + 1} of {STEPS.length}</span>
          <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={handleFinish} title="Skip tour" />
        </div>
        <div className={styles.body}>
          <Text className={styles.title}>{STEPS[step].title}</Text>
          <Text className={styles.description}>{STEPS[step].body}</Text>
        </div>
        <div className={styles.footer}>
          <div className={styles.dots}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`${styles.dot} ${i === step ? styles.dotActive : ""}`}
              />
            ))}
          </div>
          <div className={styles.navButtons}>
            {step > 0 && (
              <Button
                appearance="subtle"
                size="small"
                icon={<ChevronLeftRegular />}
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button
                appearance="primary"
                size="small"
                iconPosition="after"
                icon={<ChevronRightRegular />}
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </Button>
            ) : (
              <Button
                appearance="primary"
                size="small"
                onClick={handleFinish}
              >
                Get Started
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
