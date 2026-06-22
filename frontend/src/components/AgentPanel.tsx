import ChatPanel from "./ChatPanel";
import type { Mode, ChatMessage, ModelConfig, WorkloadContext } from "../types";
import { AGENT_TOKENS, isAgentToken } from "../constants/modeGroups";
import type { AgentToken } from "../constants/modeGroups";

// Re-exported for backward compatibility; the canonical definitions now live in
// constants/modeGroups so they can be imported without pulling in ChatPanel.
export { AGENT_TOKENS, isAgentToken };
export type { AgentToken };

interface AgentPanelProps {
  agent: AgentToken | "ask";
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
