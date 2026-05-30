import { makeStyles, tokens, Badge } from "@fluentui/react-components";
import { GlobeRegular } from "@fluentui/react-icons";
import type { WorkloadContext } from "../types";
import { hasContext } from "../hooks/useWorkloadContext";

const useStyles = makeStyles({
  strip: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 12px",
    background: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    cursor: "pointer",
    flexWrap: "wrap",
    "&:hover": {
      background: tokens.colorNeutralBackground3Hover,
    },
  },
  icon: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
  },
});

interface ContextStripProps {
  context: WorkloadContext;
  onClick: () => void;
}

export default function ContextStrip({ context, onClick }: ContextStripProps) {
  const styles = useStyles();
  if (!hasContext(context)) return null;

  const chips: string[] = [];
  if (context.region) chips.push(context.region);
  if (context.complianceFramework) chips.push(context.complianceFramework);
  if (context.budgetRange) chips.push(context.budgetRange);
  if (context.teamSize) chips.push(context.teamSize);

  return (
    <div className={styles.strip} onClick={onClick} title="Click to edit workload context">
      <span className={styles.icon}><GlobeRegular /></span>
      {chips.map((chip) => (
        <Badge key={chip} appearance="tint" color="informative" size="small">{chip}</Badge>
      ))}
    </div>
  );
}
