import { KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Spinner,
  Text,
} from "@fluentui/react-components";
import {
  SendRegular,
  DeleteRegular,
  AttachRegular,
  ChatRegular,
  PersonChatRegular,
  SlideTextRegular,
  BookRegular,
  GlobeRegular,
  ScalesRegular,
  DocumentRegular,
  ArrowMoveRegular,
  MoneyRegular,
  PulseRegular,
  DatabaseRegular,
  PlugConnectedRegular,
  OrganizationRegular,
  PersonKeyRegular,
  ShieldErrorRegular,
  BranchRegular,
  HeartPulseRegular,
} from "@fluentui/react-icons";
import ChatMessage from "./ChatMessage";
import ContextStrip from "./ContextStrip";
import { useChat } from "../hooks/useChat";
import { toPromptPrefix } from "../hooks/useWorkloadContext";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import type { ChatMessage as ChatMessageType, Mode, ModelConfig, WorkloadContext } from "../types";

interface ModeConfig {
  placeholder: string;
  examples: string[];
  emptyHeading: string;
  emptySubtitle: string;
  icon: React.ReactNode;
}

const MODE_CONFIG: Partial<Record<Mode, ModeConfig>> = {
  qa: {
    icon: <ChatRegular />,
    placeholder: "Ask any Azure architecture question…",
    emptyHeading: "Azure Expert Q&A",
    emptySubtitle: "Get cited, technically precise answers from your virtual Azure architect.",
    examples: [
      "What's the difference between Azure Service Bus and Event Hubs?",
      "How do I design a hub-spoke network for enterprise?",
      "When should I use Cosmos DB vs Azure SQL Database?",
      "What's the SLA for Azure App Service Premium v3?",
    ],
  },
  situation: {
    icon: <PersonChatRegular />,
    placeholder: "Describe the situation or challenge you're facing…",
    emptyHeading: "Situation Advisor",
    emptySubtitle: "Navigate difficult stakeholder, negotiation, and migration challenges.",
    examples: [
      "How do I present a migration to a skeptical CFO?",
      "The client wants on-prem for 'security reasons' — how do I address this?",
      "My project scope is growing out of control. What do I do?",
      "How do I handle a vendor pushing Azure alternatives I don't need?",
    ],
  },
  presentation: {
    icon: <SlideTextRegular />,
    placeholder: "What topic or audience do you need help presenting?",
    emptyHeading: "Presentation Coach",
    emptySubtitle: "Structure Azure topics compellingly for executive or technical audiences.",
    examples: [
      "Help me outline a 20-minute exec presentation on moving to Azure",
      "Structure a whiteboard session on microservices vs monolith",
      "How do I present Azure cost savings to a budget committee?",
      "Create a slide outline for 'Why Azure AI for our business'",
    ],
  },
  certprep: {
    icon: <BookRegular />,
    placeholder: "Ask a practice question, request a topic explanation, or name a domain to review…",
    emptyHeading: "Azure Certification Prep",
    emptySubtitle: "Study for AZ-305, AZ-500, AZ-104, and more with scenario-based coaching.",
    examples: [
      "Give me 5 practice questions for AZ-305 identity domain",
      "Explain Azure Policy vs RBAC for the exam",
      "What are the most tested topics in AZ-500?",
      "Explain the difference between NSG and Azure Firewall for AZ-700",
    ],
  },
  regional: {
    icon: <GlobeRegular />,
    placeholder: "Describe your workload and regional/compliance requirements…",
    emptyHeading: "Regional & AZ Advisor",
    emptySubtitle: "Get guidance on region selection, AZ coverage, data residency, and sovereign clouds.",
    examples: [
      "Which region should I use for a GDPR-compliant EU workload?",
      "Does East US 2 support availability zones for all my services?",
      "I need EU data residency and low latency to Germany — which region?",
      "Explain the difference between paired regions and AZ redundancy",
    ],
  },
  compliance: {
    icon: <DocumentRegular />,
    placeholder: "Describe your architecture and the compliance framework you need to map to…",
    emptyHeading: "Compliance Mapping",
    emptySubtitle: "Map your Azure architecture to HIPAA, PCI-DSS, SOC 2, FedRAMP, GDPR, and more.",
    examples: [
      "Map my Azure App Service + SQL Database + Key Vault app to HIPAA",
      "What PCI-DSS controls apply to my payment processing app on Azure?",
      "We need SOC 2 Type II — what Azure services and configs are required?",
      "Assess my architecture against FedRAMP Moderate",
    ],
  },
  migration: {
    icon: <ArrowMoveRegular />,
    placeholder: "Describe the workload you want to migrate to Azure…",
    emptyHeading: "Migration Assessment",
    emptySubtitle: "Get a 6 R's migration strategy, effort estimate, and wave plan for your workloads.",
    examples: [
      "Assess migrating a 10-year-old Java app on VMs to Azure",
      "We have SQL Server 2012 on-prem — what's the migration path?",
      "Migrate a SharePoint farm to Microsoft 365 or Azure",
      "Assess 50 VMs for cloud migration — give me a wave plan",
    ],
  },
  cost: {
    icon: <MoneyRegular />,
    placeholder: "Describe your Azure workload or paste a service list for cost optimization…",
    emptyHeading: "Cost Optimization",
    emptySubtitle: "Get FinOps recommendations with Azure Pricing API estimates.",
    examples: [
      "We're spending $30K/month on Azure — find me optimization opportunities",
      "Compare Reserved Instances vs pay-as-you-go for 20 D4s VMs",
      "Estimate monthly cost for: App Service P2v3 x2, SQL DB Premium, Cosmos DB 10 RU/s",
      "How do I reduce our AKS cluster cost by 40%?",
    ],
  },
  monitoring: {
    icon: <PulseRegular />,
    placeholder: "Describe your Azure services or architecture to generate monitoring config…",
    emptyHeading: "Monitoring Config Generator",
    emptySubtitle: "Generate alert rules, KQL queries, and dashboard configs for your architecture.",
    examples: [
      "Generate Azure Monitor alerts for App Service + SQL Database",
      "What KQL queries should I have for AKS cluster health?",
      "Create an Application Insights monitoring strategy for my API",
      "Generate alert rules with Bicep for my web app architecture",
    ],
  },
  compare: {
    icon: <ScalesRegular />,
    placeholder: "Name the services or ask your comparison question…",
    emptyHeading: "Service Comparison",
    emptySubtitle: "Get structured side-by-side comparisons of Azure services.",
    examples: [
      "Compare Azure Functions vs Container Apps vs App Service",
      "SQL Database vs Cosmos DB vs PostgreSQL Flexible Server for my SaaS",
      "Azure Service Bus vs Event Hubs vs Event Grid — which should I use?",
      "AKS vs Container Apps — which for microservices?",
    ],
  },
  aiarchitecture: undefined,
  dataplatform: {
    icon: <DatabaseRegular />,
    placeholder: "Describe your data platform requirements — ingestion, storage, analytics, governance…",
    emptyHeading: "Data Platform Design",
    emptySubtitle: "Design medallion architectures, Fabric/Synapse workloads, and Purview governance.",
    examples: [
      "Design a medallion lakehouse for a retail data platform using Microsoft Fabric",
      "Should I use Synapse Analytics or Fabric for my EDW modernization?",
      "Design a real-time streaming pipeline from IoT devices to Power BI",
      "How do I implement data governance with Microsoft Purview?",
    ],
  },
  apim: {
    icon: <PlugConnectedRegular />,
    placeholder: "Describe your API landscape, consumers, or integration requirements…",
    emptyHeading: "API Management Design",
    emptySubtitle: "Design APIM tier selection, policies, OAuth2 flows, and developer portal strategy.",
    examples: [
      "Design an APIM architecture for 50 internal APIs with external developer access",
      "What APIM tier should I use — Standard vs Premium for VNet injection?",
      "Implement OAuth2 JWT validation and rate limiting policies in APIM",
      "Design a backend circuit breaker pattern with APIM backend pools",
    ],
  },
  network: undefined,
  landingzone: {
    icon: <OrganizationRegular />,
    placeholder: "Describe your organization — number of subscriptions, workload types, compliance needs…",
    emptyHeading: "Landing Zone Design",
    emptySubtitle: "Design CAF-aligned management group hierarchies, Policy initiatives, and subscription vending.",
    examples: [
      "Design a CAF landing zone for a 500-person enterprise with Corp and Online workloads",
      "What Azure Policy initiatives should I assign at the management group level?",
      "Design a subscription vending pipeline using GitHub Actions and Bicep",
      "How do I enforce tagging and naming conventions across all subscriptions?",
    ],
  },
  identity: {
    icon: <PersonKeyRegular />,
    placeholder: "Describe your identity requirements — Entra design, RBAC, Conditional Access, PIM…",
    emptyHeading: "Identity & Access Design",
    emptySubtitle: "Design Entra ID architecture, Conditional Access policies, PIM, and workload identity federation.",
    examples: [
      "Design an RBAC model for a multi-team Azure subscription with PIM",
      "What Conditional Access policies should I enforce for admin accounts?",
      "Configure workload identity federation for GitHub Actions to Azure — no secrets",
      "Should I use user-assigned or system-assigned managed identity for my app?",
    ],
  },
  threatmodel: {
    icon: <ShieldErrorRegular />,
    placeholder: "Describe your architecture — components, data flows, trust boundaries…",
    emptyHeading: "Threat Modeling",
    emptySubtitle: "Run STRIDE analysis and generate a threat register with Azure security controls.",
    examples: [
      "Threat model a 3-tier web app: App Gateway → App Service → SQL Database",
      "What are the top threats to my AKS workload exposed to the internet?",
      "Model threats for a multi-tenant SaaS app using Azure AD B2C",
      "Assess IMDS SSRF risk and storage key exfiltration for my VM-based app",
    ],
  },
  devsecops: {
    icon: <BranchRegular />,
    placeholder: "Describe your CI/CD setup, team size, and security requirements…",
    emptyHeading: "DevSecOps Pipeline Design",
    emptySubtitle: "Design secure CI/CD pipelines with SAST, DAST, SCA, IaC scanning, and supply chain controls.",
    examples: [
      "Design a secure GitHub Actions pipeline for deploying to Azure Container Apps",
      "Add SAST with CodeQL and DAST with OWASP ZAP to my Azure DevOps pipeline",
      "Implement workload identity federation from GitHub Actions to Azure — no secrets",
      "Design a GitOps workflow with Flux v2 for AKS multi-environment deployments",
    ],
  },
  reliability: {
    icon: <HeartPulseRegular />,
    placeholder: "Describe your services, SLA requirements, and reliability goals…",
    emptyHeading: "SLO & Reliability Engineering",
    emptySubtitle: "Define SLIs/SLOs, error budgets, multi-window burn rate alerts, and chaos experiments.",
    examples: [
      "Define SLOs and error budgets for my 99.95% availability target on AKS",
      "Calculate composite SLA for App Gateway → App Service → SQL Database",
      "Design multi-window burn rate alerts for a 30-day error budget",
      "Plan chaos experiments with Azure Chaos Studio for my e-commerce platform",
    ],
  },
};

const GROUP_SUBTOPICS: Partial<Record<Mode, Array<{ mode: Mode; label: string }>>> = {
  security: [
    { mode: "identity", label: "Identity & Access" },
    { mode: "threatmodel", label: "Threat Modeling" },
    { mode: "devsecops", label: "DevSecOps" },
  ],
  governance: [
    { mode: "compliance", label: "Compliance Mapping" },
    { mode: "landingzone", label: "Landing Zone" },
  ],
  ops: [
    { mode: "monitoring", label: "Monitoring Config" },
    { mode: "reliability", label: "Reliability & SLO" },
  ],
};

const useStyles = makeStyles({
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  empty: {
    margin: "auto",
    textAlign: "center",
    maxWidth: "480px",
    padding: "32px 24px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  emptyIcon: {
    fontSize: "28px",
    color: "#0078D4",
    marginBottom: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "68px",
    height: "68px",
    borderRadius: "18px",
    background: "rgba(0, 120, 212, 0.12)",
    border: "1px solid rgba(0, 120, 212, 0.22)",
    flexShrink: 0,
  },
  emptyHeading: {
    fontSize: "22px",
    fontWeight: 700,
    background: "linear-gradient(135deg, #0078D4 0%, #50E6FF 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    marginBottom: "8px",
    lineHeight: "1.25",
  },
  emptySubtitle: {
    color: tokens.colorNeutralForeground3,
    marginBottom: "28px",
    fontSize: "13.5px",
    lineHeight: "1.55",
  },
  examples: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "100%",
  },
  exampleChip: {
    padding: "10px 14px",
    background: tokens.colorNeutralBackground3,
    borderRadius: "10px",
    cursor: "pointer",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: "all 0.15s",
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    "&:hover": {
      background: "rgba(0, 120, 212, 0.09)",
      color: tokens.colorNeutralForeground1,
      border: "1px solid rgba(0, 120, 212, 0.35)",
      transform: "translateX(2px)",
    },
  },
  exampleArrow: {
    color: "#0078D4",
    fontSize: "14px",
    flexShrink: 0,
    opacity: 0.65,
  },
  buildDeckBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    backgroundColor: "rgba(0, 120, 212, 0.08)",
    borderRadius: "10px",
    border: "1px solid rgba(0, 120, 212, 0.25)",
    marginBottom: "8px",
    gap: "10px",
  },
  inputArea: {
    padding: "0 16px 16px",
    background: tokens.colorNeutralBackground2,
    flexShrink: 0,
  },
  inputBox: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "14px",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.15)",
    overflow: "hidden",
  },
  textareaEl: {
    width: "100%",
    background: "transparent",
    border: "none",
    outline: "none",
    resize: "none",
    padding: "12px 14px 6px",
    fontSize: "14px",
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    boxSizing: "border-box",
    minHeight: "70px",
    "&::placeholder": {
      color: tokens.colorNeutralForeground4,
    },
    "&:disabled": {
      opacity: 0.55,
      cursor: "not-allowed",
    },
  },
  inputFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 8px 8px",
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  inputFooterLeft: {
    display: "flex",
    gap: "2px",
    alignItems: "center",
  },
  inputFooterRight: {
    display: "flex",
    gap: "4px",
    alignItems: "center",
  },
  hint: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
    paddingLeft: "4px",
    userSelect: "none",
  },
  topicBar: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "6px 14px 4px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    flexShrink: 0,
  },
  topicBarLabel: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground4,
    marginRight: "4px",
    userSelect: "none",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: 600,
  },
});

interface ChatPanelProps {
  mode: Mode;
  conversationId?: string;
  initialMessages?: ChatMessageType[];
  suggestedReplies?: string[];
  modelConfig?: ModelConfig;
  workloadContext?: WorkloadContext;
  onOpenContext?: () => void;
  onFork?: (messages: ChatMessageType[], messageIndex: number) => void;
  onSave?: (id: string, mode: Mode, messages: ChatMessageType[]) => void;
  onBuildDeck?: (conversationText: string) => void;
  onContinueIn?: (mode: Mode, seed: string) => void;
}

export default function ChatPanel({ mode, conversationId: savedId, initialMessages, suggestedReplies, modelConfig, workloadContext, onOpenContext, onFork, onSave, onBuildDeck, onContinueIn }: ChatPanelProps) {
  const styles = useStyles();
  const convId = useRef(savedId ?? crypto.randomUUID()).current;
  const subtopics = GROUP_SUBTOPICS[mode];
  const [activeTopic, setActiveTopic] = useState<Mode>(subtopics?.[0]?.mode ?? mode);
  const effectiveMode: Mode = subtopics ? activeTopic : mode;
  const { spec } = useWorkloadSpec();
  const { messages, sendMessage, isStreaming, cancel, reset } = useChat(
    effectiveMode,
    convId,
    onSave ? (msgs) => onSave(convId, effectiveMode, msgs) : undefined,
    initialMessages,
    modelConfig,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = MODE_CONFIG[effectiveMode] ?? MODE_CONFIG[mode];
  const isFirstTopicMount = useRef(true);

  useEffect(() => {
    if (isFirstTopicMount.current) { isFirstTopicMount.current = false; return; }
    reset();
  }, [activeTopic]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSend() {
    const val = textareaRef.current?.value.trim();
    if (!val || isStreaming) return;
    if (textareaRef.current) textareaRef.current.value = "";
    const prefix = workloadContext ? toPromptPrefix(workloadContext) : toSpecPromptPrefix(spec);
    const finalVal = messages.length === 0 && prefix ? prefix + val : val;
    sendMessage(finalVal);
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleExampleClick(example: string) {
    if (textareaRef.current) {
      textareaRef.current.value = example;
      textareaRef.current.focus();
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (textareaRef.current) {
        textareaRef.current.value = (textareaRef.current.value ? textareaRef.current.value + "\n\n" : "") + text;
        textareaRef.current.focus();
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleBuildDeckClick() {
    if (!onBuildDeck) return;
    const text = messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    onBuildDeck(text);
  }

  const hasMessages = messages.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.messages}>
        {!hasMessages && config && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>{config.icon}</div>
            <div className={styles.emptyHeading}>{config.emptyHeading}</div>
            <Text block className={styles.emptySubtitle}>{config.emptySubtitle}</Text>
            <div className={styles.examples}>
              {config.examples.map((ex, i) => (
                <div key={i} className={styles.exampleChip} onClick={() => handleExampleClick(ex)}>
                  <span className={styles.exampleArrow}>→</span>
                  {ex}
                </div>
              ))}
            </div>
          </div>
        )}
        {!hasMessages && !config && (
          <div className={styles.empty}>
            <Text size={400} style={{ color: tokens.colorNeutralForeground3 }}>
              Start a conversation
            </Text>
          </div>
        )}
        {messages.map((msg, index) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onFork={msg.role === "assistant" && !msg.isStreaming ? () => onFork?.(messages, index) : undefined}
            onContinueIn={msg.role === "assistant" && !msg.isStreaming ? onContinueIn : undefined}
          />
        ))}
      </div>

      <div className={styles.inputArea}>
        {suggestedReplies && suggestedReplies.length > 0 && !isStreaming && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "4px 0 8px" }}>
            {suggestedReplies.map((reply, i) => (
              <Button
                key={i}
                size="small"
                appearance="outline"
                onClick={() => sendMessage(reply)}
                style={{ maxWidth: "100%", height: "auto", padding: "4px 10px", whiteSpace: "normal", textAlign: "left" }}
              >
                {reply}
              </Button>
            ))}
          </div>
        )}
        {subtopics && (
          <div className={styles.topicBar}>
            <span className={styles.topicBarLabel}>Topic:</span>
            {subtopics.map(({ mode: tm, label }) => (
              <Button
                key={tm}
                size="small"
                appearance={activeTopic === tm ? "primary" : "subtle"}
                onClick={() => { if (activeTopic !== tm) { setActiveTopic(tm); } }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        {workloadContext && onOpenContext && (
          <ContextStrip context={workloadContext} onClick={onOpenContext} />
        )}
        {mode === "presentation" && hasMessages && onBuildDeck && (
          <div className={styles.buildDeckBar}>
            <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
              Ready to turn this into a deck?
            </Text>
            <Button
              appearance="primary"
              size="small"
              icon={<SlideTextRegular />}
              onClick={handleBuildDeckClick}
            >
              Build Deck from Conversation
            </Button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.json,.yaml,.yml,.bicep,.tf,.ps1,.sh,.csv"
          style={{ display: "none" }}
          onChange={handleFileUpload}
        />
        <div className={styles.inputBox}>
          <textarea
            ref={textareaRef}
            className={styles.textareaEl}
            placeholder={config?.placeholder ?? "Ask a question…"}
            rows={2}
            onKeyDown={handleKey}
            disabled={isStreaming}
          />
          <div className={styles.inputFooter}>
            <div className={styles.inputFooterLeft}>
              <Button
                appearance="subtle"
                size="small"
                icon={<AttachRegular />}
                onClick={() => fileInputRef.current?.click()}
                title="Attach file"
                disabled={isStreaming}
              />
              <span className={styles.hint}>Enter to send · Shift+Enter for newline</span>
            </div>
            <div className={styles.inputFooterRight}>
              {hasMessages && (
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<DeleteRegular />}
                  onClick={reset}
                  title="Clear chat"
                />
              )}
              {isStreaming ? (
                <Button appearance="primary" size="small" icon={<Spinner size="tiny" />} onClick={cancel}>
                  Stop
                </Button>
              ) : (
                <Button appearance="primary" size="small" icon={<SendRegular />} onClick={handleSend}>
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
