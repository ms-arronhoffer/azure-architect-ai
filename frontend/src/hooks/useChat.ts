import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Mode, ModelConfig, StructuredResult } from "../types";
import { useSSE } from "./useSSE";

export interface AgentRouteInfo {
  agent: string;
  recommendedTool: Mode | null;
  reason: string;
}

export function useChat(mode: Mode, _conversationId?: string, onSave?: (msgs: ChatMessage[]) => void, initialMessages?: ChatMessage[], modelConfig?: ModelConfig, onDiagram?: (xml: string) => void, onPanelEvent?: (event: { type: string; [key: string]: unknown }) => void, skillId?: string) {
  // If the last initialMessage is a user message, auto-send it on mount.
  // useMemo with [] deps so this only computes once (stable across renders).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { initMsgs, autoSendContent } = useMemo(() => {
    const msgs = initialMessages ?? [];
    const last = msgs[msgs.length - 1];
    if (last?.role === "user") {
      return { initMsgs: msgs.slice(0, -1), autoSendContent: last.content };
    }
    return { initMsgs: msgs, autoSendContent: null };
  }, []); // intentionally empty — computed once from initial prop value

  const [messages, setMessages] = useState<ChatMessage[]>(initMsgs);
  // Last router decision for the in-flight/most-recent turn. Drives the
  // "open the structured tool" launch chip when the router is confident the
  // user wants a guided, bespoke flow rather than free-text chat.
  const [agentRoute, setAgentRoute] = useState<AgentRouteInfo | null>(null);
  const { stream, isStreaming, cancel } = useSSE();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep onSave behind a stable ref so unstable inline-arrow callbacks from
  // the parent don't cause this effect to refire on every parent render and
  // schedule another debounced save. Without this, save → setConversations →
  // parent re-render → new onSave reference → effect refires → save loop.
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  // Stable ref for the side-channel panel callback (pricing worksheet / region
  // availability) so it doesn't re-create sendMessage on every parent render.
  const onPanelEventRef = useRef(onPanelEvent);
  useEffect(() => { onPanelEventRef.current = onPanelEvent; }, [onPanelEvent]);

  // Debounced save after message updates
  useEffect(() => {
    if (messages.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onSaveRef.current?.(messages), 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [messages]);

  const sendMessage = useCallback(
    async (content: string, attachments?: string[]) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };

      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setAgentRoute(null);

      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      await stream("/api/chat", {
        mode,
        messages: apiMessages,
        llm_config: modelConfig ?? null,
        attachments: attachments?.length ? attachments : null,
        skill_id: skillId ?? null,
      }, (event) => {
        if (event.type === "diagram" && typeof event.xml === "string") {
          onDiagram?.(event.xml);
          return;
        }
        if (event.type === "priced_worksheet" || event.type === "region_availability") {
          onPanelEventRef.current?.(event);
          return;
        }
        if (event.type === "agent_route") {
          const tool = typeof event.recommended_tool === "string" ? event.recommended_tool : "";
          setAgentRoute({
            agent: typeof event.agent === "string" ? event.agent : "",
            recommendedTool: tool ? (tool as Mode) : null,
            reason: typeof event.reason === "string" ? event.reason : "",
          });
          return;
        }
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            if (event.type === "token") {
              return { ...m, content: m.content + event.content };
            }
            if (event.type === "citations") {
              return { ...m, citations: event.citations, isStreaming: false };
            }
            if (event.type === "error") {
              return { ...m, content: m.content + `\n\n*Error: ${event.message}*`, isStreaming: false };
            }
            // Structured result events
            const structuredKind = _toStructuredResult(event);
            if (structuredKind) {
              return { ...m, structuredResult: structuredKind };
            }
            return m;
          })
        );
      });

      // Finalise streaming state
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.isStreaming ? { ...m, isStreaming: false } : m
        )
      );
    },
    [messages, mode, stream, onDiagram, skillId]
  );

  const loadMessages = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs);
  }, []);

  // Keep a stable ref to sendMessage so the auto-send effect doesn't re-run.
  const sendRef = useRef<(content: string, attachments?: string[]) => Promise<void>>(sendMessage);
  sendRef.current = sendMessage;
  const hasAutoSent = useRef(false);
  useEffect(() => {
    if (autoSendContent && !hasAutoSent.current) {
      hasAutoSent.current = true;
      sendRef.current(autoSendContent);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => { setMessages([]); setAgentRoute(null); }, []);

  return { messages, sendMessage, isStreaming, cancel, reset, loadMessages, agentRoute };
}

function _toStructuredResult(event: { type: string; [key: string]: unknown }): StructuredResult | null {
  switch (event.type) {
    case "service_comparison":
      return { kind: "service_comparison", data: event.comparison as never };
    case "compliance_result":
      return { kind: "compliance_result", data: event.result as never };
    case "migration_assessment":
      return { kind: "migration_assessment", data: event.assessment as never };
    case "dr_strategy":
      return { kind: "dr_strategy", data: event.strategy as never };
    case "monitoring_config":
      return { kind: "monitoring_config", data: event.config as never };
    case "cost_estimate":
      return { kind: "cost_estimate", data: event.estimate as never };
    case "cost_alternatives":
      return { kind: "cost_alternatives", data: event.alternatives as never };
    case "clarification_request":
      return { kind: "clarification_request", data: event.request as never };
    case "learning_plan":
      return { kind: "learning_plan", data: event.plan as never };
    case "network_topology":
      return { kind: "network_topology", data: event.topology as never };
    case "landing_zone_design":
      return { kind: "landing_zone_design", data: event.design as never };
    case "rbac_model":
      return { kind: "rbac_model", data: event.model as never };
    case "threat_register":
      return { kind: "threat_register", data: event.register as never };
    case "pipeline_design":
      return { kind: "pipeline_design", data: event.design as never };
    case "slo_framework":
      return { kind: "slo_framework", data: event.framework as never };
    case "sku_recommendation":
      return { kind: "sku_recommendation", data: event.recommendation as never };
    case "region_comparison":
      return { kind: "region_comparison", data: event.comparison as never };
    case "practice_exam_pack":
      return { kind: "practice_exam_pack", data: event.pack as never };
    case "stakeholder_plan":
      return { kind: "stakeholder_plan", data: event.plan as never };
    case "decision_card":
      return { kind: "decision_card", data: event.card as never };
    case "terraform_files":
      return {
        kind: "terraform_files",
        data: {
          files: event.files as Record<string, string>,
          pattern_name: event.pattern_name as string | undefined,
          notes: (event.notes as string[] | undefined) ?? [],
        } as never,
      };
    case "arm_files":
      return {
        kind: "arm_files",
        data: {
          files: event.files as Record<string, string>,
          pattern_name: event.pattern_name as string | undefined,
          notes: (event.notes as string[] | undefined) ?? [],
        } as never,
      };
    case "cicd_files":
      return {
        kind: "cicd_files",
        data: {
          platform: event.platform as string,
          files: event.files as Record<string, string>,
          pattern_name: event.pattern_name as string | undefined,
          environment: event.environment as string | undefined,
          deploy_method: event.deploy_method as string | undefined,
        } as never,
      };
    case "cost_alerts":
      return { kind: "cost_alerts", data: event.alerts as never };
    case "security_posture":
      return { kind: "security_posture", data: event.posture as never };
    case "multicloud_comparison":
      return { kind: "multicloud_comparison", data: event.comparison as never };
    case "arb_submission_proposal":
      return { kind: "arb_submission_proposal", data: event.proposal as never };
    case "arb_condition_action":
      return {
        kind: "arb_condition_action",
        data: {
          action: event.action as "clear" | "waive",
          payload: event.payload as never,
        } as never,
      };
    case "arb_status_transition":
      return { kind: "arb_status_transition", data: event.transition as never };
    default:
      return null;
  }
}
