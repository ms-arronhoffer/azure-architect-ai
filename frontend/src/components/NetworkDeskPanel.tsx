import { useEffect, useState } from "react";
import { makeStyles, tokens, Select, Label } from "@fluentui/react-components";
import ChatPanel from "./ChatPanel";
import DeskDiagramPane from "./DeskDiagramPane";
import { useDiagramState } from "../hooks/useDiagramState";
import type { ChatMessage, Mode, ModelConfig, WorkloadContext } from "../types";

const DIAGRAM_MODES = new Set<Mode>([
  "netvnet",
  "netfirewall",
  "nethybrid",
  "netprivatelink",
  "netvwan",
  "netiac",
]);

const NETWORK_GROUPS = [
  {
    group: "Design",
    items: [
      { mode: "netvnet" as Mode, label: "VNet & Subnet Architect" },
      { mode: "netvwan" as Mode, label: "Virtual WAN" },
      { mode: "netiac" as Mode, label: "Network IaC" },
    ],
  },
  {
    group: "Security",
    items: [
      { mode: "netfirewall" as Mode, label: "Firewall Engineer" },
      { mode: "netsecurity" as Mode, label: "Network Security (NSG/ASG)" },
    ],
  },
  {
    group: "Connectivity",
    items: [
      { mode: "nethybrid" as Mode, label: "Hybrid Connectivity (ER/VPN)" },
      { mode: "netprivatelink" as Mode, label: "Private Link & Endpoints" },
      { mode: "netdns" as Mode, label: "DNS Specialist" },
    ],
  },
  {
    group: "Operations",
    items: [
      { mode: "netmonitor" as Mode, label: "Network Monitor" },
      { mode: "nettroubleshoot" as Mode, label: "Network Troubleshooter" },
    ],
  },
  {
    group: "Cost",
    items: [
      { mode: "netpricing" as Mode, label: "Network Pricing Analyst" },
    ],
  },
];

export const NETWORK_DESK_MODES: Mode[] = [
  "netvnet", "netfirewall", "netsecurity", "nethybrid", "netprivatelink",
  "netvwan", "netdns", "netmonitor", "nettroubleshoot", "netiac", "netpricing",
];

const useStyles = makeStyles({
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  selectorBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    flexShrink: 0,
  },
  splitBody: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  chatSide: {
    flex: "1.2 1 0",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  diagramSide: {
    flex: "1 1 0",
    minWidth: "480px",
    display: "flex",
    flexDirection: "column",
  },
});

const MODEL_OPTIONS = [
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini (default)" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5-pro", label: "GPT-5 Pro" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
];

interface NetworkDeskPanelProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  conversationId?: string;
  initialMessages?: ChatMessage[];
  suggestedReplies?: string[];
  modelConfig?: ModelConfig;
  workloadContext?: WorkloadContext;
  onOpenContext?: () => void;
  onFork?: (messages: ChatMessage[], idx: number) => void;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[]) => void;
  onContinueIn?: (mode: Mode, seed: string) => void;
}

export default function NetworkDeskPanel({
  mode,
  onModeChange,
  conversationId,
  initialMessages,
  suggestedReplies,
  modelConfig,
  workloadContext,
  onOpenContext,
  onFork,
  onSave,
  onContinueIn,
}: NetworkDeskPanelProps) {
  const styles = useStyles();
  const [selectedModel, setSelectedModel] = useState<string>("gpt-5.4-mini");
  const diagram = useDiagramState();

  useEffect(() => {
    diagram.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const effectiveModelConfig: ModelConfig = {
    provider: modelConfig?.provider ?? "azure",
    model: selectedModel,
  };

  const showDiagram = DIAGRAM_MODES.has(mode);
  const chat = (
    <ChatPanel
      mode={mode}
      conversationId={conversationId}
      initialMessages={initialMessages}
      suggestedReplies={suggestedReplies}
      modelConfig={effectiveModelConfig}
      workloadContext={workloadContext}
      onOpenContext={onOpenContext}
      onFork={onFork}
      onSave={onSave}
      onContinueIn={onContinueIn}
      onDiagram={diagram.setXml}
    />
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.selectorBar}>
        <Label htmlFor="netdesk-specialist" weight="semibold" size="small">
          Specialist
        </Label>
        <Select
          id="netdesk-specialist"
          value={mode}
          onChange={(_, data) => onModeChange(data.value as Mode)}
          size="small"
          style={{ minWidth: "260px" }}
        >
          {NETWORK_GROUPS.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item.mode} value={item.mode}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Label htmlFor="netdesk-model" weight="semibold" size="small">
          Model
        </Label>
        <Select
          id="netdesk-model"
          value={selectedModel}
          onChange={(_, data) => setSelectedModel(data.value)}
          size="small"
          style={{ minWidth: "140px" }}
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>
      {showDiagram ? (
        <div className={styles.splitBody}>
          <div className={styles.chatSide}>{chat}</div>
          <div className={styles.diagramSide}>
            <DeskDiagramPane diagram={diagram} />
          </div>
        </div>
      ) : (
        chat
      )}
    </div>
  );
}
