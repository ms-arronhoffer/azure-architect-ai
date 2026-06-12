import { useMemo, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Button,
  Input,
  Tab,
  TabList,
  Link,
} from "@fluentui/react-components";
import { CalendarRegular, OpenRegular, SearchRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type Lifecycle = "GA" | "Preview" | "Deprecated" | "Retired" | "Legacy";
type FilterTab = "soon" | "atrisk" | "retired" | "all";

interface ModelEntry {
  provider: string;
  model: string;
  version: string;
  lifecycle: Lifecycle;
  retirement: string | null;
  replacement: string | null;
  soldBy: "Azure" | "Partner";
}

const MODELS: ModelEntry[] = [
  // Azure OpenAI
  { provider: "Azure OpenAI", model: "codex-mini", version: "2025-05-16", lifecycle: "GA", retirement: "2026-11-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4.1", version: "2025-04-14", lifecycle: "GA", retirement: "2026-10-14", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4.1-mini", version: "2025-04-14", lifecycle: "GA", retirement: "2026-10-14", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4.1-nano", version: "2025-04-14", lifecycle: "GA", retirement: "2026-10-14", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o", version: "2024-05-13", lifecycle: "Deprecated", retirement: "2026-10-01", replacement: "gpt-5.1", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o", version: "2024-08-06", lifecycle: "Deprecated", retirement: "2026-10-01", replacement: "gpt-5.1", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o", version: "2024-11-20", lifecycle: "GA", retirement: "2026-10-01", replacement: "gpt-5.1", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o-mini", version: "2024-07-18", lifecycle: "GA", retirement: "2026-10-01", replacement: "gpt-4.1-mini", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o-mini-transcribe", version: "2025-03-20", lifecycle: "GA", retirement: "2026-10-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o-mini-transcribe", version: "2025-12-15", lifecycle: "GA", retirement: "2026-12-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o-mini-tts", version: "2025-03-20", lifecycle: "Preview", retirement: "2026-10-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o-mini-tts", version: "2025-12-15", lifecycle: "GA", retirement: "2026-12-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o-transcribe", version: "2025-03-20", lifecycle: "GA", retirement: "2026-10-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-4o-transcribe-diarize", version: "2025-10-15", lifecycle: "GA", retirement: "2026-10-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5", version: "2025-08-07", lifecycle: "GA", retirement: "2027-02-06", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5-chat", version: "2025-08-07", lifecycle: "Preview", retirement: "2026-06-29", replacement: "gpt-chat-latest", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5-chat", version: "2025-10-03", lifecycle: "Preview", retirement: "2026-06-29", replacement: "gpt-chat-latest", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5-codex", version: "2025-09-15", lifecycle: "GA", retirement: "2027-03-17", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5-mini", version: "2025-08-07", lifecycle: "GA", retirement: "2027-02-06", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5-nano", version: "2025-08-07", lifecycle: "GA", retirement: "2027-02-06", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5-pro", version: "2025-10-06", lifecycle: "GA", retirement: "2027-04-07", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.1", version: "2025-11-13", lifecycle: "GA", retirement: "2027-05-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.1-chat", version: "2025-11-13", lifecycle: "Preview", retirement: "2026-06-29", replacement: "gpt-chat-latest", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.1-codex", version: "2025-11-13", lifecycle: "GA", retirement: "2027-05-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.1-codex-max", version: "2025-12-04", lifecycle: "GA", retirement: "2026-12-05", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.1-codex-mini", version: "2025-11-13", lifecycle: "GA", retirement: "2027-05-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.2", version: "2025-12-11", lifecycle: "GA", retirement: "2026-12-12", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.2-chat", version: "2025-12-11", lifecycle: "Preview", retirement: "2026-06-29", replacement: "gpt-chat-latest", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.2-chat", version: "2026-02-10", lifecycle: "Preview", retirement: "2026-06-29", replacement: "gpt-chat-latest", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.2-codex", version: "2026-01-14", lifecycle: "GA", retirement: "2027-01-14", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.3-chat", version: "2026-03-03", lifecycle: "Preview", retirement: "2026-06-29", replacement: "gpt-chat-latest", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.3-codex", version: "2026-02-24", lifecycle: "GA", retirement: "2027-02-25", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.4", version: "2026-03-05", lifecycle: "GA", retirement: "2027-03-05", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.4-mini", version: "2026-03-17", lifecycle: "GA", retirement: "2027-03-18", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.4-nano", version: "2026-03-17", lifecycle: "GA", retirement: "2027-03-18", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.4-pro", version: "2026-03-05", lifecycle: "GA", retirement: "2027-03-06", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-5.5", version: "2026-04-24", lifecycle: "GA", retirement: "2027-04-23", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-audio", version: "2025-08-28", lifecycle: "GA", retirement: "2027-02-28", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-audio-1.5", version: "2026-02-23", lifecycle: "GA", retirement: "2027-02-23", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-audio-mini", version: "2025-10-06", lifecycle: "GA", retirement: "2026-07-23", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-audio-mini", version: "2025-12-15", lifecycle: "GA", retirement: "2026-12-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-chat-latest", version: "2026-05-05", lifecycle: "Preview", retirement: "2026-11-05", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-image-1", version: "2025-04-15", lifecycle: "Preview", retirement: "2026-10-23", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-image-1-mini", version: "2025-10-06", lifecycle: "GA", retirement: "2027-04-07", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-image-1.5", version: "2025-12-16", lifecycle: "GA", retirement: "2026-12-16", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-image-2", version: "2026-04-21", lifecycle: "GA", retirement: "2027-04-21", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-realtime", version: "2025-08-28", lifecycle: "GA", retirement: "2027-02-28", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-realtime-1.5", version: "2026-02-23", lifecycle: "GA", retirement: "2027-02-23", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-realtime-2", version: "2026-05-06", lifecycle: "GA", retirement: "2027-05-06", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-realtime-mini", version: "2025-10-06", lifecycle: "GA", retirement: "2026-07-23", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "gpt-realtime-mini", version: "2025-12-15", lifecycle: "GA", retirement: "2026-12-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "o1", version: "2024-12-17", lifecycle: "Deprecated", retirement: "2026-07-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "o1-pro", version: "2025-03-19", lifecycle: "GA", retirement: "2026-09-18", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "o3", version: "2025-04-16", lifecycle: "GA", retirement: "2026-10-16", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "o3-deep-research", version: "2025-06-26", lifecycle: "GA", retirement: "2026-12-26", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "o3-mini", version: "2025-01-31", lifecycle: "Deprecated", retirement: "2026-08-02", replacement: "o4-mini", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "o3-pro", version: "2025-06-10", lifecycle: "GA", retirement: "2026-12-10", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "o4-mini", version: "2025-04-16", lifecycle: "GA", retirement: "2026-10-16", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "sora-2", version: "2025-10-06", lifecycle: "Preview", retirement: "2026-07-15", replacement: "sora-2 (2025-12-08)", soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "sora-2", version: "2025-12-08", lifecycle: "Preview", retirement: "2026-09-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "text-embedding-3-large", version: "1", lifecycle: "GA", retirement: "2027-04-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "text-embedding-3-small", version: "1", lifecycle: "GA", retirement: "2027-04-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "text-embedding-ada-002", version: "1", lifecycle: "GA", retirement: "2027-04-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "text-embedding-ada-002", version: "2", lifecycle: "GA", retirement: "2027-04-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "tts", version: "001", lifecycle: "Preview", retirement: "2026-12-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "tts-hd", version: "001", lifecycle: "GA", retirement: "2026-12-15", replacement: null, soldBy: "Azure" },
  { provider: "Azure OpenAI", model: "whisper", version: "001", lifecycle: "GA", retirement: "2026-12-15", replacement: null, soldBy: "Azure" },
  // Black Forest Labs
  { provider: "Black Forest Labs", model: "FLUX-1.1-pro", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "Black Forest Labs", model: "FLUX.1-Kontext-pro", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "Black Forest Labs", model: "FLUX.2-flex", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "Black Forest Labs", model: "FLUX.2-pro", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  // Cohere (Azure)
  { provider: "Cohere", model: "Cohere-rerank-v4.0-fast", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "Cohere", model: "Cohere-rerank-v4.0-pro", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "Cohere", model: "cohere-command-a", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "Cohere", model: "embed-v-4-0", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  // DeepSeek (Azure)
  { provider: "DeepSeek", model: "DeepSeek-R1", version: "1", lifecycle: "Legacy", retirement: "2026-08-13", replacement: null, soldBy: "Azure" },
  { provider: "DeepSeek", model: "DeepSeek-R1-0528", version: "1", lifecycle: "Legacy", retirement: "2026-07-13", replacement: null, soldBy: "Azure" },
  { provider: "DeepSeek", model: "DeepSeek-V3-0324", version: "1", lifecycle: "Legacy", retirement: "2026-07-13", replacement: "DeepSeek-V4-Flash, DeepSeek-V4-Pro", soldBy: "Azure" },
  { provider: "DeepSeek", model: "DeepSeek-V3.1", version: "1", lifecycle: "Legacy", retirement: "2026-07-13", replacement: "DeepSeek-V4-Flash, DeepSeek-V4-Pro", soldBy: "Azure" },
  { provider: "DeepSeek", model: "DeepSeek-V3.2", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "DeepSeek", model: "DeepSeek-V3.2-Speciale", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  // Meta (Azure)
  { provider: "Meta", model: "Llama-3.3-70B-Instruct", version: "—", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "Meta", model: "Llama-4-Maverick-17B-128E-Instruct-FP8", version: "—", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  // Microsoft (Azure)
  { provider: "Microsoft", model: "model-router", version: "2025-05-19", lifecycle: "Preview", retirement: "2026-07-31", replacement: null, soldBy: "Azure" },
  { provider: "Microsoft", model: "model-router", version: "2025-08-07", lifecycle: "Preview", retirement: "2026-07-31", replacement: null, soldBy: "Azure" },
  { provider: "Microsoft", model: "model-router", version: "2025-11-18", lifecycle: "GA", retirement: "2027-05-20", replacement: null, soldBy: "Azure" },
  // Mistral (Azure)
  { provider: "Mistral AI", model: "Mistral-Large-3", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "Mistral AI", model: "mistral-document-ai-2505", version: "1", lifecycle: "GA", retirement: "2026-05-31", replacement: "mistral-document-ai-2512", soldBy: "Azure" },
  { provider: "Mistral AI", model: "mistral-document-ai-2512", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  // MoonshotAI (Azure)
  { provider: "MoonshotAI", model: "Kimi-K2.5", version: "1", lifecycle: "Preview", retirement: "2027-01-26", replacement: null, soldBy: "Azure" },
  { provider: "MoonshotAI", model: "Kimi-K2.6", version: "2026-04-20", lifecycle: "Preview", retirement: "2027-04-16", replacement: null, soldBy: "Azure" },
  // OpenAI-OSS (Azure)
  { provider: "OpenAI-OSS", model: "gpt-oss-120b", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  // xAI (Azure)
  { provider: "xAI", model: "grok-3", version: "1", lifecycle: "Retired", retirement: "2026-05-01", replacement: "grok-4", soldBy: "Azure" },
  { provider: "xAI", model: "grok-3-mini", version: "1", lifecycle: "Retired", retirement: "2026-05-01", replacement: "grok-4-1-fast-reasoning", soldBy: "Azure" },
  { provider: "xAI", model: "grok-4", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "xAI", model: "grok-4-1-fast-non-reasoning", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "xAI", model: "grok-4-1-fast-reasoning", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  { provider: "xAI", model: "grok-4-20-non-reasoning", version: "1", lifecycle: "Preview", retirement: "2027-04-06", replacement: null, soldBy: "Azure" },
  { provider: "xAI", model: "grok-4-20-reasoning", version: "1", lifecycle: "Preview", retirement: "2027-04-06", replacement: null, soldBy: "Azure" },
  { provider: "xAI", model: "grok-4-fast-non-reasoning", version: "1", lifecycle: "Retired", retirement: "2026-05-01", replacement: "grok-4-1-fast-non-reasoning", soldBy: "Azure" },
  { provider: "xAI", model: "grok-4-fast-reasoning", version: "1", lifecycle: "Retired", retirement: "2026-05-01", replacement: "grok-4-1-fast-reasoning", soldBy: "Azure" },
  { provider: "xAI", model: "grok-code-fast-1", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Azure" },
  // === Partner / Marketplace ===
  // Anthropic
  { provider: "Anthropic", model: "claude-haiku-4-5", version: "—", lifecycle: "Preview", retirement: "2026-10-19", replacement: null, soldBy: "Partner" },
  { provider: "Anthropic", model: "claude-mythos-preview", version: "—", lifecycle: "Preview", retirement: "2027-04-02", replacement: null, soldBy: "Partner" },
  { provider: "Anthropic", model: "claude-opus-4-1", version: "—", lifecycle: "Preview", retirement: "2026-10-19", replacement: null, soldBy: "Partner" },
  { provider: "Anthropic", model: "claude-opus-4-5", version: "—", lifecycle: "Preview", retirement: "2026-10-19", replacement: null, soldBy: "Partner" },
  { provider: "Anthropic", model: "claude-opus-4-6", version: "—", lifecycle: "Preview", retirement: "2027-02-02", replacement: null, soldBy: "Partner" },
  { provider: "Anthropic", model: "claude-opus-4-7", version: "—", lifecycle: "Preview", retirement: "2027-04-06", replacement: null, soldBy: "Partner" },
  { provider: "Anthropic", model: "claude-sonnet-4-5", version: "—", lifecycle: "Preview", retirement: "2026-10-19", replacement: null, soldBy: "Partner" },
  { provider: "Anthropic", model: "claude-sonnet-4-6", version: "—", lifecycle: "Preview", retirement: "2027-02-10", replacement: null, soldBy: "Partner" },
  // Cohere (Partner)
  { provider: "Cohere", model: "Cohere-command-r-08-2024", version: "1", lifecycle: "Retired", retirement: "2026-05-12", replacement: null, soldBy: "Partner" },
  { provider: "Cohere", model: "Cohere-command-r-plus-08-2024", version: "1", lifecycle: "Retired", retirement: "2026-05-12", replacement: null, soldBy: "Partner" },
  { provider: "Cohere", model: "Cohere-rerank-v3.5", version: "1", lifecycle: "Deprecated", retirement: "2026-05-14", replacement: "Cohere-rerank-v4.0-pro / v4.0-fast", soldBy: "Partner" },
  { provider: "Cohere", model: "Cohere-embed-v3-english", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Cohere", model: "Cohere-embed-v3-multilingual", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  // DeepSeek (Partner)
  { provider: "DeepSeek", model: "DeepSeek-V4-Flash", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  // Fireworks
  { provider: "Fireworks", model: "FW-DeepSeek-V3.1", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-DeepSeek-V3.2", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-GLM-4.7", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-GLM-5", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-GLM-5.1", version: "1", lifecycle: "Preview", retirement: "2026-08-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-GPT-OSS-120B", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-Kimi-K2-Instruct-0905", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-Kimi-K2-Thinking", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-Kimi-K2.5", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-MiniMax-M2.5", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-Qwen3-14B", version: "1", lifecycle: "Preview", retirement: "2026-07-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-Qwen3.5-122B-A10B", version: "1", lifecycle: "Preview", retirement: "2026-08-01", replacement: null, soldBy: "Partner" },
  { provider: "Fireworks", model: "FW-Qwen3.5-397B-A17B", version: "1", lifecycle: "Preview", retirement: "2026-08-01", replacement: null, soldBy: "Partner" },
  // Meta (Partner)
  { provider: "Meta", model: "Llama-3.2-11B-Vision-Instruct", version: "—", lifecycle: "Deprecated", retirement: "2026-06-13", replacement: null, soldBy: "Partner" },
  { provider: "Meta", model: "Llama-3.2-90B-Vision-Instruct", version: "—", lifecycle: "Deprecated", retirement: "2026-06-13", replacement: null, soldBy: "Partner" },
  { provider: "Meta", model: "Llama-4-Scout-17B-16E-Instruct", version: "—", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Meta", model: "Meta-Llama-3.1-405B-Instruct", version: "—", lifecycle: "Deprecated", retirement: "2026-06-13", replacement: null, soldBy: "Partner" },
  { provider: "Meta", model: "Meta-Llama-3.1-8B", version: "—", lifecycle: "Deprecated", retirement: "2026-06-13", replacement: null, soldBy: "Partner" },
  { provider: "Meta", model: "Meta-Llama-3.1-8B-Instruct", version: "—", lifecycle: "Deprecated", retirement: "2026-06-13", replacement: null, soldBy: "Partner" },
  // Microsoft (Partner)
  { provider: "Microsoft", model: "Phi-4", version: "—", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Microsoft", model: "Phi-4-mini-instruct", version: "—", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Microsoft", model: "Phi-4-mini-reasoning", version: "—", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Microsoft", model: "Phi-4-multimodal-instruct", version: "—", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Microsoft", model: "Phi-4-reasoning", version: "—", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  // Mistral (Partner)
  { provider: "Mistral AI", model: "Codestral-2501", version: "2", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Mistral AI", model: "Ministral-3B", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Mistral AI", model: "Mistral-large", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Mistral AI", model: "mistral-medium-2505", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  { provider: "Mistral AI", model: "mistral-small-2503", version: "1", lifecycle: "GA", retirement: null, replacement: null, soldBy: "Partner" },
  // NTT Data
  { provider: "NTT Data", model: "tsuzumi-7b", version: "2", lifecycle: "Legacy", retirement: "2026-08-31", replacement: "tsuzumi2", soldBy: "Partner" },
  // StabilityAI
  { provider: "StabilityAI", model: "Stable-Diffusion-3.5-Large", version: "1", lifecycle: "Deprecated", retirement: "2026-07-31", replacement: null, soldBy: "Partner" },
  { provider: "StabilityAI", model: "Stable-Image-Core", version: "1", lifecycle: "Deprecated", retirement: "2026-07-31", replacement: null, soldBy: "Partner" },
  { provider: "StabilityAI", model: "Stable-Image-Ultra", version: "1", lifecycle: "Deprecated", retirement: "2026-07-31", replacement: null, soldBy: "Partner" },
];

const LEARN_URL = "https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule";
const PROVIDERS = [...new Set(MODELS.map((m) => m.provider))].sort();
const SOON_DAYS = 90;

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

const lifecycleBadgeColor: Record<Lifecycle, "success" | "informative" | "warning" | "danger" | "subtle"> = {
  GA: "success",
  Preview: "informative",
  Deprecated: "warning",
  Retired: "danger",
  Legacy: "subtle",
};

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    background: tokens.colorNeutralBackground2,
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 28px 16px",
    background: "var(--glass-bg)",
    borderBottom: "1px solid var(--glass-border)",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  headerIcon: {
    fontSize: "28px",
    color: "#8764B8",
    filter: "drop-shadow(0 0 8px rgba(135,100,184,0.5))",
  },
  title: {
    fontSize: "18px",
    fontWeight: 700,
    color: tokens.colorNeutralForeground1,
    lineHeight: 1.2,
    marginBottom: "6px",
  },
  subtitle: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  controls: {
    padding: "12px 28px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    flexShrink: 0,
  },
  controlsRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap",
  },
  searchBox: {
    width: "220px",
    flexShrink: 0,
  },
  countBadge: {
    marginLeft: "auto",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  tableWrap: {
    flex: 1,
    overflowY: "auto",
    padding: "0 28px 24px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: "12px",
    fontSize: "13px",
  },
  thead: {
    position: "sticky",
    top: 0,
    background: tokens.colorNeutralBackground2,
    zIndex: 1,
  },
  th: {
    padding: "8px 10px",
    textAlign: "left",
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: tokens.colorNeutralForeground3,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    ":hover": {
      background: "rgba(255,255,255,0.03)",
    },
  },
  td: {
    padding: "7px 10px",
    verticalAlign: "middle",
    color: tokens.colorNeutralForeground1,
  },
  modelName: {
    fontFamily: "monospace",
    fontSize: "12px",
    fontWeight: 500,
  },
  version: {
    fontFamily: "monospace",
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
  },
  retireSoon: {
    color: "#E87C2B",
    fontWeight: 600,
  },
  retireVerySOon: {
    color: "#C50F1F",
    fontWeight: 700,
  },
  retirePast: {
    color: tokens.colorNeutralForeground4,
  },
  retireNormal: {
    color: tokens.colorNeutralForeground2,
  },
  soldByChip: {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: "3px",
    fontSize: "10px",
    fontWeight: 600,
    background: "rgba(0,120,212,0.15)",
    color: "#5BA8F5",
  },
  soldByPartner: {
    background: "rgba(135,100,184,0.15)",
    color: "#B19CD9",
  },
  noResults: {
    textAlign: "center",
    padding: "48px 0",
    color: tokens.colorNeutralForeground3,
  },
  providerChips: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  providerLabel: {
    fontSize: "11px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginRight: "2px",
    flexShrink: 0,
  },
});

const FILTER_LABEL: Record<FilterTab, string> = {
  soon: "Retiring Within 90 Days",
  atrisk: "Deprecated or Legacy",
  retired: "Retired",
  all: "All Models",
};

const COLUMNS = ["Provider", "Model", "Version", "Lifecycle", "Retirement Date", "Replacement", "Sold By"] as const;

function modelToRow(m: ModelEntry): string[] {
  return [m.provider, m.model, m.version, m.lifecycle, m.retirement ?? "—", m.replacement ?? "—", m.soldBy];
}

function exportToXlsx(models: ModelEntry[], filterLabel: string) {
  const generated = new Date().toISOString().slice(0, 10);
  const rows = [
    ["Azure AI Model Lifecycle Report"],
    [`Filter: ${filterLabel}`],
    [`Generated: ${generated}  ·  Source: Microsoft Learn Azure Foundry model retirement schedule`],
    [],
    [...COLUMNS],
    ...models.map(modelToRow),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [20, 34, 14, 12, 16, 30, 10].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Model Lifecycle");
  XLSX.writeFile(wb, `azure-model-lifecycle-${generated}.xlsx`);
}

function exportToPdf(models: ModelEntry[], filterLabel: string) {
  const generated = new Date().toISOString().slice(0, 10);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.setTextColor(0, 78, 140);
  doc.text("Azure AI Model Lifecycle Report", 14, 16);

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Filter: ${filterLabel}`, 14, 23);
  doc.text(`Generated: ${generated}  ·  Source: Microsoft Learn Azure Foundry model retirement schedule`, 14, 28);

  autoTable(doc, {
    startY: 33,
    head: [COLUMNS as unknown as string[]],
    body: models.map(modelToRow),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [0, 78, 140], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 248, 252] },
    columnStyles: { 1: { cellWidth: 50 }, 5: { cellWidth: 42 } },
  });

  const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width - 20, doc.internal.pageSize.height - 6);
  }

  doc.save(`azure-model-lifecycle-${generated}.pdf`);
}

export default function ModelLifecyclePanel() {
  const styles = useStyles();
  const [filter, setFilter] = useState<FilterTab>("soon");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const now = Date.now();
    const q = search.toLowerCase();

    return MODELS.filter((m) => {
      const retMs = m.retirement ? new Date(m.retirement).getTime() : null;
      const days = retMs !== null ? Math.ceil((retMs - now) / (24 * 60 * 60 * 1000)) : null;

      const matchesSearch = !q ||
        m.model.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (m.replacement ?? "").toLowerCase().includes(q);

      if (!matchesSearch) return false;
      if (providerFilter && m.provider !== providerFilter) return false;

      switch (filter) {
        case "soon":
          return retMs !== null && days! <= SOON_DAYS;
        case "atrisk":
          return m.lifecycle === "Deprecated" || m.lifecycle === "Legacy";
        case "retired":
          return m.lifecycle === "Retired";
        case "all":
          return true;
      }
    }).sort((a, b) => {
      if (!a.retirement && !b.retirement) return 0;
      if (!a.retirement) return 1;
      if (!b.retirement) return -1;
      return new Date(a.retirement).getTime() - new Date(b.retirement).getTime();
    });
  }, [filter, search, providerFilter]);

  function retirementCell(retirement: string | null) {
    if (!retirement) return <span className={styles.retireNormal}>—</span>;
    const days = daysUntil(retirement);
    if (days < 0) return <span className={styles.retirePast}>{retirement} (past)</span>;
    if (days <= 30) return <span className={styles.retireVerySOon}>{retirement} ({days}d)</span>;
    if (days <= SOON_DAYS) return <span className={styles.retireSoon}>{retirement} ({days}d)</span>;
    return <span className={styles.retireNormal}>{retirement}</span>;
  }

  const soonCount = useMemo(() => MODELS.filter(m => {
    if (!m.retirement) return false;
    return daysUntil(m.retirement) <= SOON_DAYS;
  }).length, []);

  const atRiskCount = MODELS.filter(m => m.lifecycle === "Deprecated" || m.lifecycle === "Legacy").length;
  const retiredCount = MODELS.filter(m => m.lifecycle === "Retired").length;

  return (
    <div className={styles.root}>
      <div className={styles.panelHeader}>
        <div className={styles.headerLeft}>
          <CalendarRegular className={styles.headerIcon} />
          <div>
            <Text className={styles.title}>AI Model Lifecycle</Text>
            <Text className={styles.subtitle}>Azure Foundry model retirement schedule · {MODELS.length} models tracked</Text>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowDownloadRegular />}
            onClick={() => exportToXlsx(filtered, FILTER_LABEL[filter])}
          >
            Export XLSX
          </Button>
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowDownloadRegular />}
            onClick={() => exportToPdf(filtered, FILTER_LABEL[filter])}
          >
            Export PDF
          </Button>
          <Link href={LEARN_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
            Microsoft Learn <OpenRegular style={{ fontSize: "14px" }} />
          </Link>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.controlsRow}>
          <TabList
            selectedValue={filter}
            onTabSelect={(_, d) => setFilter(d.value as FilterTab)}
            size="small"
          >
            <Tab value="soon">Retiring ≤90 days <Badge size="small" shape="rounded" color="warning" style={{ marginLeft: "4px" }}>{soonCount}</Badge></Tab>
            <Tab value="atrisk">Deprecated / Legacy <Badge size="small" shape="rounded" color="subtle" style={{ marginLeft: "4px" }}>{atRiskCount}</Badge></Tab>
            <Tab value="retired">Retired <Badge size="small" shape="rounded" color="danger" style={{ marginLeft: "4px" }}>{retiredCount}</Badge></Tab>
            <Tab value="all">All ({MODELS.length})</Tab>
          </TabList>
          <Input
            className={styles.searchBox}
            contentBefore={<SearchRegular />}
            placeholder="Filter by model or provider…"
            value={search}
            onChange={(_, d) => setSearch(d.value)}
            size="small"
          />
          <Text className={styles.countBadge}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</Text>
        </div>
        <div className={styles.providerChips}>
          <Text className={styles.providerLabel}>Provider</Text>
          <Badge
            size="small"
            shape="rounded"
            appearance={providerFilter === null ? "filled" : "outline"}
            color={providerFilter === null ? "brand" : "subtle"}
            style={{ cursor: "pointer", userSelect: "none" }}
            onClick={() => setProviderFilter(null)}
          >
            All
          </Badge>
          {PROVIDERS.map((p) => (
            <Badge
              key={p}
              size="small"
              shape="rounded"
              appearance={providerFilter === p ? "filled" : "outline"}
              color={providerFilter === p ? "brand" : "subtle"}
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => setProviderFilter(providerFilter === p ? null : p)}
            >
              {p}
            </Badge>
          ))}
        </div>
      </div>

      <div className={styles.tableWrap}>
        {filtered.length === 0 ? (
          <div className={styles.noResults}>
            <Text>No models match the current filter.</Text>
          </div>
        ) : (
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Provider</th>
                <th className={styles.th}>Model</th>
                <th className={styles.th}>Version</th>
                <th className={styles.th}>Lifecycle</th>
                <th className={styles.th}>Retirement Date</th>
                <th className={styles.th}>Replacement</th>
                <th className={styles.th}>Sold By</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr key={i} className={styles.tr}>
                  <td className={styles.td}>{m.provider}</td>
                  <td className={styles.td}><span className={styles.modelName}>{m.model}</span></td>
                  <td className={styles.td}><span className={styles.version}>{m.version}</span></td>
                  <td className={styles.td}>
                    <Badge size="small" shape="rounded" color={lifecycleBadgeColor[m.lifecycle]}>
                      {m.lifecycle}
                    </Badge>
                  </td>
                  <td className={styles.td}>{retirementCell(m.retirement)}</td>
                  <td className={styles.td} style={{ fontSize: "12px", color: tokens.colorNeutralForeground3 }}>
                    {m.replacement ?? "—"}
                  </td>
                  <td className={styles.td}>
                    <span className={`${styles.soldByChip} ${m.soldBy === "Partner" ? styles.soldByPartner : ""}`}>
                      {m.soldBy === "Azure" ? "Azure" : "Partner"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
