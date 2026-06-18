import ChatPanel from "./ChatPanel";
import type { Mode, ChatMessage, ModelConfig, WorkloadContext } from "../types";

export type AgentToken =
  | "architect"
  | "cost"
  | "operations"
  | "compliance"
  | "engagement";

export const AGENT_TOKENS: AgentToken[] = [
  "architect",
  "cost",
  "operations",
  "compliance",
  "engagement",
];

export function isAgentToken(m: Mode): m is AgentToken {
  return (AGENT_TOKENS as Mode[]).includes(m);
}

interface AgentPanelProps {
  agent: AgentToken;
  conversationId?: string;
  initialMessages?: ChatMessage[];
  suggestedReplies?: string[];
  modelConfig?: ModelConfig;
  workloadContext?: WorkloadContext;
  onOpenContext?: () => void;
  onFork?: (messages: ChatMessage[], messageIndex: number) => void;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[]) => void;
  onContinueIn?: (mode: Mode, seed: string) => void;
  onDiagram?: (xml: string) => void;
  pendingSend?: { content: string; nonce: number };
}

export default function AgentPanel({ agent, ...rest }: AgentPanelProps) {
  return <ChatPanel mode={agent} {...rest} />;
}
