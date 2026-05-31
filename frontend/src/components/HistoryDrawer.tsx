import {
  makeStyles,
  tokens,
  Button,
  Text,
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  Badge,
} from "@fluentui/react-components";
import { DismissRegular, DeleteRegular } from "@fluentui/react-icons";
import type { ConversationRecord, Mode } from "../types";

const MODE_LABELS: Partial<Record<Mode, string>> = {
  qa: "Q&A",
  situation: "Situation",
  certprep: "Cert Prep",
  regional: "Regional",
  compare: "Compare",
  governance: "Governance",
  compliance: "Compliance",
  identity: "Identity",
  security: "Security",
  devsecops: "DevSecOps",
  migration: "Migration",
  cost: "Cost",
  monitoring: "Monitoring",
  ops: "Ops",
  architecture: "Architecture",
  network: "Network",
  aiarchitecture: "AI Arch",
  dataplatform: "Data Platform",
  apim: "APIM",
  waf: "WAF",
  review: "Review",
  drbc: "DR/BC",
  sizing: "Sizing",
  tco: "TCO",
  threatmodel: "Threat Model",
  reliability: "Reliability",
  landingzone: "Landing Zone",
  presentation: "Presentation",
  reference: "Reference",
  codegen: "Code Gen",
  learningplan: "Learning Plan",
  bootstrap: "Bootstrap",
};

const PANEL_MODES = new Set<Mode>([
  "architecture", "network", "aiarchitecture", "dataplatform", "apim",
  "waf", "review", "drbc", "sizing", "tco", "threatmodel", "reliability", "landingzone",
]);

const useStyles = makeStyles({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "4px 0",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "4px",
    cursor: "pointer",
    "&:hover": { background: tokens.colorNeutralBackground3 },
  },
  itemContent: {
    flex: 1,
    overflow: "hidden",
  },
  title: {
    fontSize: "13px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    display: "block",
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginTop: "2px",
  },
  date: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
  },
  clearRow: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "4px 0 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    marginBottom: "8px",
  },
  empty: {
    textAlign: "center",
    padding: "32px 16px",
    color: tokens.colorNeutralForeground3,
  },
});

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationRecord[];
  onLoad: (conv: ConversationRecord) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export default function HistoryDrawer({
  open,
  onClose,
  conversations,
  onLoad,
  onDelete,
  onClear,
}: HistoryDrawerProps) {
  const styles = useStyles();

  return (
    <Drawer
      type="overlay"
      position="end"
      open={open}
      onOpenChange={(_, d) => !d.open && onClose()}
      style={{ width: 320 }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onClose} />
          }
        >
          History
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {conversations.length === 0 ? (
          <div className={styles.empty}>
            <Text size={300}>No saved sessions yet.</Text>
          </div>
        ) : (
          <>
            <div className={styles.clearRow}>
              <Button
                appearance="subtle"
                size="small"
                icon={<DeleteRegular />}
                onClick={onClear}
              >
                Clear all
              </Button>
            </div>
            <div className={styles.list}>
              {conversations.map((conv) => {
                const isPanel = PANEL_MODES.has(conv.mode);
                const hasSaved = !!conv.structuredResult;
                return (
                  <div key={conv.id} className={styles.item} onClick={() => { onLoad(conv); onClose(); }}>
                    <Badge
                      appearance="tint"
                      size="small"
                      color={isPanel ? "brand" : "informative"}
                    >
                      {MODE_LABELS[conv.mode] ?? conv.mode}
                    </Badge>
                    <div className={styles.itemContent}>
                      <Text className={styles.title}>{conv.title}</Text>
                      <div className={styles.meta}>
                        <span className={styles.date}>
                          {new Date(conv.updatedAt).toLocaleDateString()}
                        </span>
                        {hasSaved && (
                          <Badge appearance="filled" color="success" size="extra-small">
                            Saved
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<DeleteRegular />}
                      onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                      title="Delete"
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DrawerBody>
    </Drawer>
  );
}
