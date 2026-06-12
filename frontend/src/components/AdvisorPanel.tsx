import { useState } from "react";
import { makeStyles, tokens, Select, Label } from "@fluentui/react-components";
import ChatPanel from "./ChatPanel";
import type { ChatMessage, Mode, ModelConfig, WorkloadContext } from "../types";

const ADVISOR_GROUPS = [
  {
    group: "General Advisory",
    items: [
      { mode: "qa" as Mode, label: "Azure Expert Q&A" },
      { mode: "situation" as Mode, label: "Situation Advisor" },
      { mode: "regional" as Mode, label: "Regional Advisor" },
      { mode: "certprep" as Mode, label: "Cert Prep" },
      { mode: "compare" as Mode, label: "Service Comparison" },
    ],
  },
  {
    group: "Governance & Compliance",
    items: [
      { mode: "governance" as Mode, label: "Governance" },
      { mode: "compliance" as Mode, label: "Compliance Mapping" },
      { mode: "landingzone" as Mode, label: "Landing Zone" },
      { mode: "identity" as Mode, label: "Identity & Access" },
    ],
  },
  {
    group: "Security",
    items: [
      { mode: "security" as Mode, label: "Security Advisor" },
      { mode: "threatmodel" as Mode, label: "Threat Modeling" },
      { mode: "devsecops" as Mode, label: "DevSecOps" },
    ],
  },
  {
    group: "Migration & Operations",
    items: [
      { mode: "migration" as Mode, label: "Migration Assessment" },
      { mode: "cost" as Mode, label: "Cost Optimization" },
      { mode: "monitoring" as Mode, label: "Monitoring Config" },
      { mode: "ops" as Mode, label: "Observability & SRE" },
      { mode: "reliability" as Mode, label: "Reliability & SLO" },
    ],
  },
  {
    group: "Data Engineering",
    items: [
      { mode: "datapipelineadvisor" as Mode, label: "Pipeline Advisor" },
    ],
  },
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

export const ADVISOR_MODES: Mode[] = [
  "qa", "situation", "certprep", "regional", "compare",
  "governance", "compliance", "landingzone", "identity",
  "security", "threatmodel", "devsecops",
  "migration", "cost", "monitoring", "ops", "reliability",
  "datapipelineadvisor",
];

interface AdvisorPanelProps {
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

const MODEL_OPTIONS = [
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "gpt-5.4", label: "GPT-5.4" },
];

export default function AdvisorPanel({
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
}: AdvisorPanelProps) {
  const styles = useStyles();
  const [selectedModel, setSelectedModel] = useState<string>("gpt-5.4-mini");

  const effectiveModelConfig: ModelConfig = {
    provider: modelConfig?.provider ?? "azure",
    model: selectedModel,
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.selectorBar}>
        <Label htmlFor="advisor-persona" weight="semibold" size="small">
          Persona
        </Label>
        <Select
          id="advisor-persona"
          value={mode}
          onChange={(_, data) => onModeChange(data.value as Mode)}
          size="small"
          style={{ minWidth: "220px" }}
        >
          {ADVISOR_GROUPS.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item.mode} value={item.mode}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Label htmlFor="advisor-model" weight="semibold" size="small">
          Model
        </Label>
        <Select
          id="advisor-model"
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
