import { useState } from "react";
import { makeStyles, tokens, Select, Label } from "@fluentui/react-components";
import ChatPanel from "./ChatPanel";
import type { ChatMessage, Mode, ModelConfig, WorkloadContext } from "../types";

const DATA_GROUPS = [
  {
    group: "Storage & Modeling",
    items: [
      { mode: "datalake" as Mode, label: "Data Lake Architect" },
      { mode: "datawarehouse" as Mode, label: "Data Warehouse" },
      { mode: "datalakehouse" as Mode, label: "Lakehouse Specialist" },
    ],
  },
  {
    group: "Movement",
    items: [
      { mode: "datastream" as Mode, label: "Streaming Specialist" },
      { mode: "datamigration" as Mode, label: "Database Migration" },
    ],
  },
  {
    group: "Governance",
    items: [
      { mode: "datagovernance" as Mode, label: "Data Governance (Purview)" },
      { mode: "datasecurity" as Mode, label: "Data Security" },
      { mode: "dataquality" as Mode, label: "Data Quality" },
    ],
  },
  {
    group: "Build & Cost",
    items: [
      { mode: "dataiac" as Mode, label: "Data Platform IaC" },
      { mode: "datacost" as Mode, label: "Data Cost Analyst" },
    ],
  },
];

export const DATA_DESK_MODES: Mode[] = [
  "datalake", "datawarehouse", "datastream", "datalakehouse", "datagovernance",
  "datasecurity", "datamigration", "datacost", "dataquality", "dataiac",
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

interface DataDeskPanelProps {
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

export default function DataDeskPanel({
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
}: DataDeskPanelProps) {
  const styles = useStyles();
  const [selectedModel, setSelectedModel] = useState<string>("gpt-5.4-mini");

  const effectiveModelConfig: ModelConfig = {
    provider: modelConfig?.provider ?? "azure",
    model: selectedModel,
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.selectorBar}>
        <Label htmlFor="datadesk-specialist" weight="semibold" size="small">
          Specialist
        </Label>
        <Select
          id="datadesk-specialist"
          value={mode}
          onChange={(_, data) => onModeChange(data.value as Mode)}
          size="small"
          style={{ minWidth: "260px" }}
        >
          {DATA_GROUPS.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item.mode} value={item.mode}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Label htmlFor="datadesk-model" weight="semibold" size="small">
          Model
        </Label>
        <Select
          id="datadesk-model"
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
      />
    </div>
  );
}
