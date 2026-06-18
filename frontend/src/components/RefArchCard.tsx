import {
  Card,
  CardHeader,
  CardFooter,
  Badge,
  Button,
  Text,
  makeStyles,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import {
  Open24Regular,
  Code24Regular,
  StarFilled,
  EditRegular,
  DeleteRegular,
  RocketRegular,
  ShieldCheckmarkRegular,
} from "@fluentui/react-icons";
import type { ReferenceArch } from "../types";

const useStyles = makeStyles({
  card: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    transition: "box-shadow 0.2s ease",
    ":hover": { boxShadow: tokens.shadow16 },
  },
  headerBadges: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    marginBottom: tokens.spacingVerticalXS,
  },
  summary: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    display: "-webkit-box",
    WebkitLineClamp: "4",
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    marginBottom: tokens.spacingVerticalS,
  },
  meta: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    marginTop: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  metaRow: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    alignItems: "center",
    flexWrap: "wrap",
  },
  metaLabel: {
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
  },
  wafRow: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  wafPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 6px",
    borderRadius: "10px",
    background: tokens.colorNeutralBackground3,
    fontSize: "11px",
    fontWeight: 600,
  },
  footer: {
    marginTop: "auto",
    display: "flex",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
    alignItems: "center",
  },
  footerSpacer: { flex: 1 },
  servicesText: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
});

const PILLAR_LABEL: Record<string, string> = {
  reliability: "Rel",
  security: "Sec",
  cost: "Cost",
  operations: "Ops",
  performance: "Perf",
};

function formatMonthly(value: ReferenceArch["estimated_monthly"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  const first = entries[0];
  if (first[0] === "range_label" && typeof first[1] === "string") return first[1];
  // Show the first region's number as the headline; format as currency.
  const numeric = entries.filter(([, v]) => typeof v === "number") as [string, number][];
  if (numeric.length === 0) return String(first[1]);
  const [region, amount] = numeric[0];
  return `~$${amount.toLocaleString()}/mo (${region})`;
}

interface RefArchCardProps {
  arch: ReferenceArch;
  onEdit?: (arch: ReferenceArch) => void;
  onDelete?: (arch: ReferenceArch) => void;
  onUseAsStarting?: (arch: ReferenceArch) => void;
}

export function RefArchCard({ arch, onEdit, onDelete, onUseAsStarting }: RefArchCardProps) {
  const styles = useStyles();
  const description = arch.summary ?? arch.description ?? "";
  const monthly = formatMonthly(arch.estimated_monthly);
  const services = arch.services ?? [];
  const tags = arch.tags ?? [];
  const wafEntries = Object.entries(arch.waf_score ?? {});
  const isCurated = arch.source && arch.source !== "custom";

  return (
    <Card className={styles.card}>
      <CardHeader
        header={
          <div>
            <div className={styles.headerBadges}>
              {arch.featured && (
                <Tooltip content="Featured" relationship="label">
                  <Badge appearance="filled" color="brand" icon={<StarFilled />}>
                    Featured
                  </Badge>
                </Tooltip>
              )}
              {arch.source === "microsoft_official" && (
                <Badge appearance="filled" color="informative">
                  MS Official
                </Badge>
              )}
              {arch.source === "community" && (
                <Badge appearance="outline" color="informative">
                  Community
                </Badge>
              )}
              {arch.source === "custom" && (
                <Badge appearance="outline" color="success">
                  Custom
                </Badge>
              )}
              {arch.category && (
                <Badge appearance="outline" color="subtle">
                  {arch.category}
                </Badge>
              )}
              {arch.complexity && (
                <Badge appearance="ghost" color="subtle">
                  {arch.complexity}
                </Badge>
              )}
              {tags.slice(0, 3).map((tag) => (
                <Badge key={tag} appearance="outline" color="informative">
                  {tag}
                </Badge>
              ))}
            </div>
            <Text weight="semibold" size={400}>{arch.title}</Text>
          </div>
        }
        description={
          <div>
            {description && <Text className={styles.summary}>{description}</Text>}
            <div className={styles.meta}>
              {wafEntries.length > 0 && (
                <div className={styles.metaRow}>
                  <ShieldCheckmarkRegular fontSize={14} />
                  <div className={styles.wafRow}>
                    {wafEntries.map(([pillar, score]) => (
                      <span key={pillar} className={styles.wafPill}>
                        {PILLAR_LABEL[pillar] ?? pillar.slice(0, 4)} {score}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {monthly && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Cost:</span>
                  <span>{monthly}</span>
                </div>
              )}
              {services.length > 0 && (
                <div className={styles.servicesText}>
                  {services.slice(0, 5).join(" • ")}
                  {services.length > 5 ? ` +${services.length - 5} more` : ""}
                </div>
              )}
              {arch.bicep_avm_module && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>AVM:</span>
                  <code style={{ fontSize: "11px" }}>{arch.bicep_avm_module}</code>
                </div>
              )}
            </div>
          </div>
        }
      />

      <CardFooter className={styles.footer}>
        {onUseAsStarting && (
          <Button
            appearance="primary"
            icon={<RocketRegular />}
            onClick={() => onUseAsStarting(arch)}
          >
            Use as starting point
          </Button>
        )}
        {arch.learn_url && (
          <Button
            appearance="outline"
            icon={<Open24Regular />}
            as="a"
            href={arch.learn_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on Learn
          </Button>
        )}
        {arch.repo_url && (
          <Button
            appearance="outline"
            icon={<Code24Regular />}
            as="a"
            href={arch.repo_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Repo
          </Button>
        )}
        <div className={styles.footerSpacer} />
        {onEdit && (
          <Tooltip
            content={isCurated ? "Curated entry — only `featured` is editable" : "Edit"}
            relationship="label"
          >
            <Button
              appearance="subtle"
              icon={<EditRegular />}
              aria-label="Edit reference architecture"
              onClick={() => onEdit(arch)}
            />
          </Tooltip>
        )}
        {onDelete && !isCurated && (
          <Tooltip content="Delete" relationship="label">
            <Button
              appearance="subtle"
              icon={<DeleteRegular />}
              aria-label="Delete reference architecture"
              onClick={() => onDelete(arch)}
            />
          </Tooltip>
        )}
      </CardFooter>
    </Card>
  );
}
