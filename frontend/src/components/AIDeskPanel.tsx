import { useState } from "react";
import { makeStyles, tokens, Select, Label } from "@fluentui/react-components";
import ChatPanel from "./ChatPanel";
import type { ChatMessage, Mode, ModelConfig, WorkloadContext } from "../types";

const AI_GROUPS = [
  {
    group: "Foundation",
    items: [
      { mode: "aifoundry" as Mode, label: "AI Foundry Architect" },
      { mode: "aimodel" as Mode, label: "Model Selection Advisor" },
      { mode: "aiiac" as Mode, label: "AI Workload IaC" },
    ],
  },
  {
    group: "Patterns",
    items: [
      { mode: "airag" as Mode, label: "RAG Architect" },
      { mode: "aiagents" as Mode, label: "AI Agents Specialist" },
      { mode: "aifinetune" as Mode, label: "Fine-Tuning Specialist" },
    ],
  },
  {
    group: "Lifecycle",
    items: [
      { mode: "aimlops" as Mode, label: "MLOps Engineer" },
      { mode: "aieval" as Mode, label: "AI Evaluation" },
    ],
  },
  {
    group: "Safety & Cost",
    items: [
      { mode: "aisafety" as Mode, label: "Responsible AI & Safety" },
      { mode: "aicost" as Mode, label: "AI Cost Analyst" },
    ],
  },
];

export const AI_DESK_MODES: Mode[] = [
  "aifoundry", "aimodel", "airag", "aiagents", "aifinetune",
  "aimlops", "aieval", "aisafety", "aicost", "aiiac",
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

interface AIDeskPanelProps {
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

export default function AIDeskPanel({
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
}: AIDeskPanelProps) {
  const styles = useStyles();
  const [selectedModel, setSelectedModel] = useState<string>("gpt-5.4-mini");

  const effectiveModelConfig: ModelConfig = {
    provider: modelConfig?.provider ?? "azure",
    model: selectedModel,
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.selectorBar}>
        <Label htmlFor="aidesk-specialist" weight="semibold" size="small">
          Specialist
        </Label>
        <Select
          id="aidesk-specialist"
          value={mode}
          onChange={(_, data) => onModeChange(data.value as Mode)}
          size="small"
          style={{ minWidth: "260px" }}
        >
          {AI_GROUPS.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item.mode} value={item.mode}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Label htmlFor="aidesk-model" weight="semibold" size="small">
          Model
        </Label>
        <Select
          id="aidesk-model"
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
