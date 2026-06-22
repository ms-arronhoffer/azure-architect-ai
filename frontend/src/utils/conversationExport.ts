import type { ChatMessage, Mode } from "../types";

const MODE_LABELS: Partial<Record<Mode, string>> = {
  qa: "Expert Q&A",
  architecture: "Architecture Design",
  waf: "WAF Assessment",
  review: "Architecture Review",
  compliance: "Compliance Mapping",
  migration: "Migration Assessment",
  cost: "Cost Optimization",
  drbc: "DR/BC Design",
  threatmodel: "Threat Modeling",
  reliability: "Reliability & SLO",
  troubleshoot: "Troubleshoot",
  codegen: "Code Generator",
  learningplan: "Learning Plan",
  presentation: "Presentation Coach",
  architect: "Architect",
  operations: "Operations",
  engagement: "Engagement Hub",
};

export function conversationToMarkdown(
  title: string,
  mode: Mode,
  messages: ChatMessage[],
  createdAt?: number
): string {
  const parts: string[] = [];
  parts.push(`# ${title}`);
  parts.push("");
  parts.push(`**Mode:** ${MODE_LABELS[mode] ?? mode}`);
  if (createdAt) {
    parts.push(`**Date:** ${new Date(createdAt).toLocaleString()}`);
  }
  parts.push(`**Messages:** ${messages.length}`);
  parts.push("");
  parts.push("---");
  parts.push("");

  for (const msg of messages) {
    const role = msg.role === "user" ? "You" : "Assistant";
    parts.push(`### ${role}`);
    parts.push("");
    parts.push(msg.content);

    if (msg.citations && msg.citations.length > 0) {
      parts.push("");
      parts.push("**Citations:**");
      for (const cite of msg.citations) {
        parts.push(`- [${cite.title}](${cite.url})`);
      }
    }
    parts.push("");
  }

  parts.push("---");
  parts.push("_Exported from Azure Architect AI_");

  return parts.join("\n");
}

export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
