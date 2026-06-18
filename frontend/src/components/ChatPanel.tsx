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
  DismissRegular,
  ServerRegular,
  SparkleRegular,
  DataBarVerticalRegular,
} from "@fluentui/react-icons";
import ChatMessage from "./ChatMessage";
import ContextStrip from "./ContextStrip";
import { useChat } from "../hooks/useChat";
import { toPromptPrefix } from "../hooks/useWorkloadContext";
import { useWorkloadSpec, toSpecPromptPrefix } from "../hooks/useWorkloadSpec";
import { apiFetch } from "../config/api";
import type { ChatMessage as ChatMessageType, Mode, ModelConfig, WorkloadContext } from "../types";

// All file types the model supports natively (images, PDF) plus server-parsed docs
const ACCEPTED_FILE_TYPES =
  "image/png,image/jpeg,image/gif,image/webp,.pdf,.docx,.pptx,.txt,.md,.json,.yaml,.yml,.bicep,.tf,.ps1,.sh,.csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

interface Attachment {
  name: string;
  data: string; // base64 data URL for images/PDF; extracted text for DOCX/PPTX
  kind: "image" | "pdf" | "doc";
}

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
  // Network Desk
  netvnet: {
    icon: <GlobeRegular />,
    placeholder: "Describe your VNet / subnet / IP plan needs…",
    emptyHeading: "VNet & Subnet Architect",
    emptySubtitle: "Design VNets, subnet plans, CIDR allocation, and peering.",
    examples: [
      "Design a hub-spoke VNet plan for prod, non-prod, and shared services",
      "Plan a /16 IP space split across 6 subnets with room for growth",
      "Should I use VNet peering or VWAN for 12 spokes across 3 regions?",
      "How do I avoid overlapping CIDR ranges with my on-prem network?",
    ],
  },
  netfirewall: {
    icon: <GlobeRegular />,
    placeholder: "Describe your egress / inspection / firewall rules…",
    emptyHeading: "Firewall Engineer",
    emptySubtitle: "Design Azure Firewall, rule collections, and forced tunneling.",
    examples: [
      "Design Azure Firewall rules for an AKS cluster needing internet egress",
      "Compare Azure Firewall Standard vs Premium for TLS inspection",
      "Force-tunnel all egress through on-prem inspection — how do I configure?",
      "Generate Bicep for Azure Firewall Policy with app and network rules",
    ],
  },
  netsecurity: {
    icon: <GlobeRegular />,
    placeholder: "Describe the workload / NSG / ASG requirements…",
    emptyHeading: "Network Security (NSG/ASG)",
    emptySubtitle: "Design NSG rules, Application Security Groups, and micro-segmentation.",
    examples: [
      "Design NSG rules for a 3-tier web app using ASGs",
      "Block lateral movement between subnets — what NSG pattern do I use?",
      "Audit my NSG for overly permissive rules",
      "Generate Bicep for ASG-based segmentation of web, app, and data tiers",
    ],
  },
  nethybrid: {
    icon: <GlobeRegular />,
    placeholder: "Describe your on-prem connectivity needs — ER, VPN, bandwidth…",
    emptyHeading: "Hybrid Connectivity (ER/VPN)",
    emptySubtitle: "Design ExpressRoute, VPN gateways, and hybrid routing.",
    examples: [
      "ExpressRoute vs Site-to-Site VPN for 500 Mbps to Azure US East",
      "Design an active-active ExpressRoute with VPN failover",
      "How do I configure BGP route propagation through a hub VNet?",
      "Plan a global hybrid network across 3 on-prem sites and 2 Azure regions",
    ],
  },
  netprivatelink: {
    icon: <GlobeRegular />,
    placeholder: "Describe the PaaS service you want to expose privately…",
    emptyHeading: "Private Link & Endpoints",
    emptySubtitle: "Design Private Endpoints, Private Link Services, and private DNS.",
    examples: [
      "Set up Private Endpoint for Storage Account with private DNS zone",
      "Compare Service Endpoints vs Private Endpoints for SQL Database",
      "Design Private Link Service to expose my internal API to partners",
      "Generate Bicep for Private Endpoint + private DNS zone group",
    ],
  },
  netvwan: {
    icon: <GlobeRegular />,
    placeholder: "Describe your global network topology and branches…",
    emptyHeading: "Virtual WAN Architect",
    emptySubtitle: "Design Virtual WAN hubs, branch connectivity, and routing intent.",
    examples: [
      "Design a Virtual WAN for 50 branches across 4 continents",
      "Should I use Virtual WAN or self-managed hub-spoke for my enterprise?",
      "Configure routing intent to inspect inter-spoke traffic with Azure Firewall",
      "Plan Virtual WAN Secure Hub with Firewall and Premium SKU sizing",
    ],
  },
  netdns: {
    icon: <GlobeRegular />,
    placeholder: "Describe your DNS / resolution requirements…",
    emptyHeading: "DNS Specialist",
    emptySubtitle: "Design Azure DNS, Private DNS zones, and DNS Private Resolver.",
    examples: [
      "Design a Private DNS strategy with central DNS Private Resolver",
      "Resolve on-prem names from Azure VMs without DNS forwarders on every VNet",
      "Plan a split-horizon DNS for internal and external app endpoints",
      "How do I link Private DNS zones across spoke VNets in a hub-spoke?",
    ],
  },
  netmonitor: {
    icon: <GlobeRegular />,
    placeholder: "Describe the network resource or flow you want to monitor…",
    emptyHeading: "Network Monitor",
    emptySubtitle: "Configure Network Watcher, Connection Monitor, and flow logs.",
    examples: [
      "Generate KQL to find top talkers from NSG flow logs",
      "Design Connection Monitor to track latency from spokes to on-prem",
      "Set up alerts when ExpressRoute BGP sessions drop",
      "Monitor packet drops on Azure Firewall and create a dashboard",
    ],
  },
  nettroubleshoot: {
    icon: <GlobeRegular />,
    placeholder: "Describe the connectivity issue you're seeing…",
    emptyHeading: "Network Troubleshooter",
    emptySubtitle: "Diagnose connectivity, routing, and DNS resolution issues.",
    examples: [
      "VM in spoke can't reach SQL DB Private Endpoint in hub — why?",
      "App Service VNet integration: outbound to SQL fails with timeout",
      "ExpressRoute is up but on-prem can't reach Azure — checklist?",
      "Generate KQL to find dropped packets on NSG for a specific VM",
    ],
  },
  netiac: {
    icon: <GlobeRegular />,
    placeholder: "Describe the network resource you want to generate IaC for…",
    emptyHeading: "Network IaC Generator",
    emptySubtitle: "Generate Bicep / Terraform for hub-spoke, firewall, peering, and private DNS.",
    examples: [
      "Generate Bicep for a hub-spoke with Firewall, Bastion, and 3 spokes",
      "Terraform for VWAN with 2 hubs, secure connectivity, and policy",
      "Bicep module for Private Endpoint + private DNS zone group",
      "Terraform for NSG with ASG-based 3-tier segmentation",
    ],
  },
  netpricing: {
    icon: <GlobeRegular />,
    placeholder: "Describe the network topology to estimate costs…",
    emptyHeading: "Network Pricing Analyst",
    emptySubtitle: "Estimate Azure networking spend — gateways, egress, peering, Private Endpoints.",
    examples: [
      "Cost of Azure Firewall Premium with 5 TB/mo of inspected traffic in East US",
      "ExpressRoute 1 Gbps Premium with global reach — monthly cost",
      "Estimate hub-spoke spend: VWAN + Firewall + 10 spokes + 2 TB egress",
      "Compare Standard vs Premium VPN Gateway pricing for 200 Mbps",
    ],
  },
  // Compute Desk
  compsku: {
    icon: <ServerRegular />,
    placeholder: "Describe your workload — CPU, RAM, IOPS, OS, region…",
    emptyHeading: "VM SKU Selector",
    emptySubtitle: "Pick the right VM SKU family, generation, and size for your workload.",
    examples: [
      "Recommend a VM SKU for a 16-vCPU, 64 GB RAM Linux workload in East US",
      "What's the best burstable SKU for a low-traffic dev SQL server?",
      "Compare Dsv5 vs Esv5 for an OLTP workload with 5000 IOPS",
      "Pick a memory-optimized SKU for a 256 GB RAM SAP HANA test",
    ],
  },
  compscale: {
    icon: <ServerRegular />,
    placeholder: "Describe the workload pattern to scale — events, schedule, metrics…",
    emptyHeading: "Scale-Set & Autoscale",
    emptySubtitle: "Design VMSS, autoscale rules, and scheduled scaling.",
    examples: [
      "Design VMSS autoscale rules for a CPU-bound API with daily peaks",
      "Generate Bicep for a VMSS with custom metric autoscale from App Insights",
      "Scale to 0 at night, back up at 7am — what's the rule expression?",
      "Compare Standard vs Flexible VMSS orchestration for stateful workloads",
    ],
  },
  compdisk: {
    icon: <ServerRegular />,
    placeholder: "Describe your storage IOPS / throughput / capacity needs…",
    emptyHeading: "Managed Disk & Storage",
    emptySubtitle: "Pick disk SKUs, design data/log/temp layout, and estimate cost.",
    examples: [
      "Disk plan for SQL Server VM needing 20K IOPS and 4 TB capacity",
      "Compare Premium SSD v2 vs Ultra Disk for a latency-sensitive DB",
      "Design data + log + tempdb disk layout for SQL on a D16s_v5",
      "Estimate monthly cost for 4× P40 Premium SSD in East US",
    ],
  },
  compha: {
    icon: <ServerRegular />,
    placeholder: "Describe the workload and availability target…",
    emptyHeading: "High Availability",
    emptySubtitle: "Design AZ-aware VMs, availability sets, and zone-redundant patterns.",
    examples: [
      "Design a zone-redundant 3-VM web tier with Standard Load Balancer",
      "Availability Set vs Availability Zones — which for my SQL AG?",
      "Calculate composite SLA for 2 VMs across 2 AZs behind a zonal LB",
      "Generate Bicep for AZ-spread VMSS with zonal-redundant Premium disks",
    ],
  },
  compdr: {
    icon: <ServerRegular />,
    placeholder: "Describe your DR requirements — RPO, RTO, secondary region…",
    emptyHeading: "VM Disaster Recovery",
    emptySubtitle: "Design Azure Site Recovery, ASR plans, and failover runbooks.",
    examples: [
      "Design ASR for 25 IaaS VMs with 1h RPO and 4h RTO to West US",
      "Generate a failover runbook for a 3-tier app using ASR recovery plans",
      "Estimate cost of ASR replication for 10 D8s_v5 VMs",
      "Compare Backup vault snapshots vs ASR for DR vs accidental delete",
    ],
  },
  compperf: {
    icon: <ServerRegular />,
    placeholder: "Describe the perf issue or workload you want to tune…",
    emptyHeading: "VM Performance Tuning",
    emptySubtitle: "Diagnose CPU, memory, disk, and network bottlenecks on Azure VMs.",
    examples: [
      "SQL VM is hitting 100% CPU at peak — what to check first?",
      "Generate KQL to find disk latency spikes on a Premium SSD",
      "Tune Linux kernel and accelerated networking on a Standard_D16s_v5",
      "Design a perf monitoring dashboard for a VMSS web farm",
    ],
  },
  compmonitor: {
    icon: <ServerRegular />,
    placeholder: "Describe the VMs / VMSS you want to monitor…",
    emptyHeading: "Compute Monitoring",
    emptySubtitle: "Configure VM Insights, alerts, and Action Groups for compute resources.",
    examples: [
      "Generate alert rules for CPU, memory, disk, and boot failures on 50 VMs",
      "Design a VM Insights workspace strategy across 3 subscriptions",
      "Generate KQL to find VMs with sustained 90%+ CPU over 1 hour",
      "Create a dashboard for a VMSS showing instance count and per-instance load",
    ],
  },
  comptroubleshoot: {
    icon: <ServerRegular />,
    placeholder: "Describe the VM issue — boot, network, perf, agent…",
    emptyHeading: "VM Troubleshooter",
    emptySubtitle: "Diagnose VM boot failures, agent issues, and connectivity problems.",
    examples: [
      "Linux VM stuck in 'Starting' state — what diagnostics to run?",
      "VM RDP fails after a Windows update — recovery steps?",
      "Azure VM agent (waagent / WindowsAzureGuestAgent) shows unhealthy",
      "Generate a runbook to redeploy a frozen VM and capture diagnostics",
    ],
  },
  compsecurity: {
    icon: <ServerRegular />,
    placeholder: "Describe the VM workload and security requirements…",
    emptyHeading: "VM Security & Hardening",
    emptySubtitle: "Harden VMs with Defender for Cloud, JIT, disk encryption, and update management.",
    examples: [
      "Harden a public-facing Linux VM with JIT, NSG, and Defender for Cloud",
      "Generate Bicep for VMs with Azure Disk Encryption + Key Vault",
      "Enforce TLS 1.2 only and disable SMBv1 on a Windows VMSS",
      "Defender for Servers Plan 1 vs Plan 2 — which for a regulated workload?",
    ],
  },
  compcost: {
    icon: <ServerRegular />,
    placeholder: "Describe your VM footprint to optimize or estimate cost…",
    emptyHeading: "Compute Cost Analyst",
    emptySubtitle: "Estimate VM/VMSS/disk cost and find Reserved Instance and Spot opportunities.",
    examples: [
      "Estimate monthly cost for 20× D8s_v5 with P30 disks in East US, 730h",
      "Find Reserved Instance savings for my current VM portfolio",
      "Where can I safely use Spot VMs to cut cost by 60%+?",
      "Compare PAYG vs 1-yr RI vs 3-yr Savings Plan for a steady-state web tier",
    ],
  },
  // AI Desk
  aifoundry: {
    icon: <SparkleRegular />,
    placeholder: "Describe your AI workload — agents, models, knowledge sources…",
    emptyHeading: "AI Foundry Architect",
    emptySubtitle: "Design Microsoft Foundry projects, hubs, model deployments, and agents.",
    examples: [
      "Design an AI Foundry project for a customer support copilot with RAG",
      "Hub vs project structure for 3 teams sharing models and connections",
      "Plan a Foundry workspace with private networking and Key Vault",
      "Wire up a Foundry agent with Bing grounding and a code interpreter",
    ],
  },
  aimodel: {
    icon: <SparkleRegular />,
    placeholder: "Describe your use case — latency, quality, cost, modality…",
    emptyHeading: "Model Selection Advisor",
    emptySubtitle: "Pick the right Azure OpenAI / Foundry model for your workload.",
    examples: [
      "GPT-4o vs GPT-4o mini for a high-volume classification task",
      "Pick the best model for a 200K-token document summarization workload",
      "Compare o3-mini vs GPT-4.1 for reasoning-heavy tool use",
      "Recommend an embedding model for multilingual RAG over 5M docs",
    ],
  },
  airag: {
    icon: <SparkleRegular />,
    placeholder: "Describe your knowledge base and retrieval requirements…",
    emptyHeading: "RAG Architect",
    emptySubtitle: "Design retrieval-augmented generation pipelines with AI Search and embeddings.",
    examples: [
      "Design a RAG pipeline over 50K PDFs using Azure AI Search hybrid retrieval",
      "Chunking strategy for technical manuals — fixed size vs semantic?",
      "Re-ranking with cross-encoder vs LLM-as-judge — when to use each?",
      "Plan an evaluation harness for RAG groundedness and recall",
    ],
  },
  aiagents: {
    icon: <SparkleRegular />,
    placeholder: "Describe the agent task, tools, and orchestration…",
    emptyHeading: "AI Agents Specialist",
    emptySubtitle: "Design single-agent and multi-agent systems with Foundry, Semantic Kernel, or AutoGen.",
    examples: [
      "Design a multi-agent system for travel booking: planner, search, booking agents",
      "When should I use Foundry Agents vs Semantic Kernel vs AutoGen?",
      "Plan tool definitions and guardrails for a finance-domain agent",
      "Handle long-running tool calls and human-in-the-loop approvals",
    ],
  },
  aifinetune: {
    icon: <SparkleRegular />,
    placeholder: "Describe your fine-tuning use case — task, data, model…",
    emptyHeading: "Fine-Tuning Specialist",
    emptySubtitle: "Plan SFT, DPO, and LoRA fine-tuning on Azure OpenAI / Foundry.",
    examples: [
      "When is fine-tuning better than RAG for a domain-specific Q&A bot?",
      "Plan a SFT dataset for tone adaptation on GPT-4o mini",
      "Compare LoRA vs full fine-tuning cost on Azure OpenAI",
      "Design an eval-then-train loop for iterative fine-tuning",
    ],
  },
  aimlops: {
    icon: <SparkleRegular />,
    placeholder: "Describe your ML lifecycle — training, deployment, monitoring…",
    emptyHeading: "MLOps Engineer",
    emptySubtitle: "Design MLOps pipelines with Azure ML, MLflow, and CI/CD.",
    examples: [
      "Design an Azure ML training + deployment pipeline with GitHub Actions",
      "Set up model registry, staging, and canary deployment for online endpoints",
      "Plan data and model drift monitoring for a production credit-scoring model",
      "Compare managed online endpoints vs AKS-hosted inference",
    ],
  },
  aieval: {
    icon: <SparkleRegular />,
    placeholder: "Describe what you want to evaluate — groundedness, safety, quality…",
    emptyHeading: "AI Evaluation",
    emptySubtitle: "Design eval suites for LLM apps using Foundry evaluators and custom metrics.",
    examples: [
      "Build an eval set for a RAG bot covering groundedness, relevance, fluency",
      "Set up red-team adversarial eval using PyRIT against my chat app",
      "Define custom LLM-judge eval for tone and helpfulness",
      "Wire continuous evaluation in Foundry for a production agent",
    ],
  },
  aisafety: {
    icon: <SparkleRegular />,
    placeholder: "Describe your application and risk areas…",
    emptyHeading: "Responsible AI & Safety",
    emptySubtitle: "Apply Azure AI Content Safety, prompt shields, and Responsible AI controls.",
    examples: [
      "Design content safety filters for a public-facing chatbot",
      "Mitigate prompt injection risk in a customer-facing RAG app",
      "Plan a Responsible AI impact assessment for a healthcare AI feature",
      "Configure Foundry guardrails: jailbreak, PII, protected material",
    ],
  },
  aicost: {
    icon: <SparkleRegular />,
    placeholder: "Describe your AI workload to estimate cost and optimize…",
    emptyHeading: "AI Cost Analyst",
    emptySubtitle: "Estimate Azure OpenAI / Foundry spend and recommend PTU vs PAYG.",
    examples: [
      "Estimate monthly cost: GPT-4o, 5M input + 2M output tokens/day",
      "When does PTU beat PAYG for a steady-traffic chatbot?",
      "Compare cost of GPT-4o vs 4o-mini for a classification workload at 10M req/mo",
      "Plan caching + prompt compression to cut LLM cost by 40%",
    ],
  },
  aiiac: {
    icon: <SparkleRegular />,
    placeholder: "Describe the AI resources you want to deploy via IaC…",
    emptyHeading: "AI Workload IaC",
    emptySubtitle: "Generate Bicep / Terraform for AI Foundry, Azure OpenAI, AI Search, and Cognitive Services.",
    examples: [
      "Generate Bicep for an Azure OpenAI account with GPT-4o + embedding deployments",
      "Terraform for AI Foundry hub + project + AI Search + Key Vault",
      "Bicep for a private-networked Azure OpenAI with Private Endpoint",
      "Generate IaC for a complete RAG stack: AOAI + Search + Storage + App Service",
    ],
  },
  // Data Desk
  datalake: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe your data volume, sources, and access patterns…",
    emptyHeading: "Data Lake Architect",
    emptySubtitle: "Design ADLS Gen2 zones, folder structure, and access patterns.",
    examples: [
      "Design ADLS Gen2 zones: raw, enriched, curated for a retail analytics platform",
      "Folder partitioning for 5 PB of IoT telemetry by date/device",
      "ACLs vs RBAC vs POSIX permissions in ADLS Gen2 — what should I use?",
      "Generate Bicep for ADLS Gen2 with hierarchical namespace and lifecycle rules",
    ],
  },
  datawarehouse: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe your warehouse / analytics workload…",
    emptyHeading: "Data Warehouse",
    emptySubtitle: "Design Synapse Dedicated SQL, Fabric Warehouse, or SQL DB analytics workloads.",
    examples: [
      "Synapse Dedicated SQL vs Fabric Warehouse — when to use each?",
      "Size a Fabric F-SKU for a 2 TB warehouse with 50 concurrent BI users",
      "Design distribution and partitioning for a 10-billion-row fact table",
      "Migration path from on-prem Teradata to Synapse Dedicated SQL",
    ],
  },
  datastream: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe your streaming source, throughput, and latency target…",
    emptyHeading: "Streaming Specialist",
    emptySubtitle: "Design Event Hubs, Stream Analytics, Fabric Eventstreams, and real-time pipelines.",
    examples: [
      "Design a real-time IoT pipeline: 100K events/sec from devices to Power BI",
      "Event Hubs Capture vs Eventstream for landing into ADLS",
      "Compare Stream Analytics, Spark Structured Streaming, and Fabric Eventstreams",
      "Plan partitioning and consumer groups for 1M events/sec Event Hub",
    ],
  },
  datalakehouse: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe your lakehouse goals — medallion, format, engine…",
    emptyHeading: "Lakehouse Specialist",
    emptySubtitle: "Design medallion lakehouses on Fabric, Databricks, or Synapse with Delta / Iceberg.",
    examples: [
      "Design a medallion lakehouse in Microsoft Fabric for retail",
      "Fabric Lakehouse vs Databricks Unity Catalog — which fits my org?",
      "OneLake shortcuts vs data copies — when to use each?",
      "Plan Delta table partitioning and OPTIMIZE/VACUUM schedule",
    ],
  },
  datagovernance: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe your governance scope — assets, policies, owners…",
    emptyHeading: "Data Governance (Purview)",
    emptySubtitle: "Design Microsoft Purview governance: catalog, lineage, classification, and access policies.",
    examples: [
      "Roll out Purview catalog across ADLS, Fabric, and Synapse",
      "Design glossary, classifications, and steward roles for a regulated bank",
      "Configure data lineage tracking from ADF to Power BI via Purview",
      "Set up Purview DLP policies for PII and PHI in Fabric Lakehouses",
    ],
  },
  datasecurity: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe the data assets and security requirements…",
    emptyHeading: "Data Security",
    emptySubtitle: "Design encryption, masking, row-level security, and private networking for data platforms.",
    examples: [
      "Design TDE + Always Encrypted for a multi-tenant SQL DB",
      "Row-level security and dynamic data masking pattern for Synapse",
      "Lock down ADLS Gen2 with Private Endpoint and disable public access",
      "Plan CMK encryption with Key Vault HSM for Fabric and Synapse",
    ],
  },
  datamigration: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe the source DB, size, and target Azure service…",
    emptyHeading: "Database Migration",
    emptySubtitle: "Plan migrations to Azure SQL, PostgreSQL, MySQL, Cosmos DB, and Fabric.",
    examples: [
      "Migration plan from on-prem SQL Server 2016 to Azure SQL Managed Instance",
      "Oracle to PostgreSQL Flexible Server — assessment and tooling",
      "MongoDB Atlas to Cosmos DB for MongoDB vCore — migration approach",
      "Migrate a 5 TB SQL DB with <1h cutover using Azure DMS",
    ],
  },
  datacost: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe the data workload to estimate or optimize cost…",
    emptyHeading: "Data Cost Analyst",
    emptySubtitle: "Estimate and optimize Fabric, Synapse, Cosmos DB, and SQL costs.",
    examples: [
      "Right-size Fabric F-SKU for 50 BI users + 2 TB warehouse + nightly ELT",
      "Cosmos DB autoscale vs provisioned throughput — cost crossover point?",
      "Synapse Dedicated SQL DW100c vs DW500c — when does it pay off?",
      "Find cost-saving opportunities in a 500 TB ADLS Gen2 lake",
    ],
  },
  dataquality: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe the data domain and quality dimensions to enforce…",
    emptyHeading: "Data Quality",
    emptySubtitle: "Design DQ rules, profiling, and monitoring with Purview, Great Expectations, or Fabric.",
    examples: [
      "Design DQ rules for customer master data: completeness, uniqueness, validity",
      "Compare Purview Data Quality vs Great Expectations for Fabric Lakehouses",
      "Plan a DQ scorecard with alerting for nightly ELT pipelines",
      "Profile a noisy CSV source and recommend cleansing rules",
    ],
  },
  dataiac: {
    icon: <DataBarVerticalRegular />,
    placeholder: "Describe the data platform resources to deploy via IaC…",
    emptyHeading: "Data Platform IaC",
    emptySubtitle: "Generate Bicep / Terraform for ADLS, Fabric, Synapse, Cosmos DB, SQL, and ADF.",
    examples: [
      "Bicep for ADLS Gen2 + Synapse Workspace + Spark Pool + private networking",
      "Terraform for Cosmos DB account with multi-region writes and CMK",
      "Bicep module for Microsoft Fabric capacity (F-SKU) with admin role",
      "Terraform for Azure SQL DB elastic pool with auto-failover group",
    ],
  },
  architect: {
    icon: <BookRegular />,
    placeholder: "Design, IaC, diagrams, WAF, landing zones, AVM, AI, network, identity, data…",
    emptyHeading: "Architect",
    emptySubtitle: "Design Azure workloads end-to-end. The router picks the right domain context for you.",
    examples: [
      "Design a hub-and-spoke landing zone for a healthcare ISV across two regions",
      "Recommend the right AVM module for AKS with private clusters",
      "Generate Bicep for an event-driven microservices architecture on ACA",
      "Architect a RAG application on Azure OpenAI + AI Search with private networking",
    ],
  },
  operations: {
    icon: <HeartPulseRegular />,
    placeholder: "Reliability, troubleshooting, DRBC, runbooks, monitoring, service health…",
    emptyHeading: "Operations",
    emptySubtitle: "Run and recover workloads. Ask about incidents, SLOs, alerts, and recovery design.",
    examples: [
      "Build a DRBC plan for an AKS workload with RPO 15 min and RTO 1 h",
      "Diagnose intermittent 503s from an App Service behind Front Door",
      "Draft an SRE runbook for SQL MI failover and post-incident review",
      "Recommend an alert + workbook set for an event-driven Function App",
    ],
  },
  engagement: {
    icon: <PersonChatRegular />,
    placeholder: "Intake, RFPs, exec decks, learning plans, what's new, customer comms…",
    emptyHeading: "Engagement Hub",
    emptySubtitle: "Customer-facing artifacts and discovery. Scope to an Engagement to pre-load context.",
    examples: [
      "Run a guided intake for a new Azure modernization engagement",
      "Draft an RFP response for a regulated financial services migration",
      "Build an executive deck on our recommended landing zone",
      "Summarize this month's Azure updates relevant to a healthcare ISV",
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
  onDiagram?: (xml: string) => void;
  pendingSend?: { content: string; nonce: number };
}

export default function ChatPanel({ mode, conversationId: savedId, initialMessages, suggestedReplies, modelConfig, workloadContext, onOpenContext, onFork, onSave, onBuildDeck, onContinueIn, onDiagram, pendingSend }: ChatPanelProps) {
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
    onDiagram,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = MODE_CONFIG[effectiveMode] ?? MODE_CONFIG[mode];
  const isFirstTopicMount = useRef(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (isFirstTopicMount.current) { isFirstTopicMount.current = false; return; }
    reset();
  }, [activeTopic]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pendingSend || !pendingSend.content || isStreaming) return;
    const prefix = workloadContext ? toPromptPrefix(workloadContext) : toSpecPromptPrefix(spec);
    const finalVal = messages.length === 0 && prefix ? prefix + pendingSend.content : pendingSend.content;
    sendMessage(finalVal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSend?.nonce]);

  function handleSend() {
    const val = textareaRef.current?.value.trim();
    if (!val || isStreaming) return;
    if (textareaRef.current) textareaRef.current.value = "";
    const prefix = workloadContext ? toPromptPrefix(workloadContext) : toSpecPromptPrefix(spec);
    const finalVal = messages.length === 0 && prefix ? prefix + val : val;
    const attachmentData = attachments.map((a) => a.data);
    setAttachments([]);
    sendMessage(finalVal, attachmentData.length > 0 ? attachmentData : undefined);
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

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const lower = file.name.toLowerCase();

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setAttachments((prev) => [...prev, { name: file.name, data: dataUrl, kind: "image" }]);
      };
      reader.readAsDataURL(file);
      return;
    }

    if (lower.endsWith(".pdf")) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setAttachments((prev) => [...prev, { name: file.name, data: dataUrl, kind: "pdf" }]);
      };
      reader.readAsDataURL(file);
      return;
    }

    if (lower.endsWith(".docx") || lower.endsWith(".pptx") || lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      try {
        const body = await file.arrayBuffer();
        const resp = await apiFetch("/api/parse", {
          method: "POST",
          body,
          headers: { "X-Filename": file.name, "Content-Type": "application/octet-stream" },
        });
        if (resp.ok) {
          const { text } = await resp.json() as { text: string };
          setAttachments((prev) => [...prev, { name: file.name, data: text, kind: "doc" }]);
          setUploadError(null);
        } else {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }));
          setUploadError(`Could not parse ${file.name}: ${err.detail ?? resp.statusText}`);
        }
      } catch (e) {
        setUploadError(`Could not upload ${file.name}: ${e instanceof Error ? e.message : "network error"}`);
      }
      return;
    }

    // Text/code files — paste directly into textarea
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (textareaRef.current) {
        textareaRef.current.value = (textareaRef.current.value ? textareaRef.current.value + "\n\n" : "") + text;
        textareaRef.current.focus();
      }
    };
    reader.readAsText(file);
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
          accept={ACCEPTED_FILE_TYPES}
          style={{ display: "none" }}
          onChange={handleFileUpload}
        />
        {uploadError && (
          <Text size={100} style={{ color: "var(--colorPaletteRedForeground1)", padding: "2px 0 4px" }}>{uploadError}</Text>
        )}
        {attachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "4px 0 6px" }}>
            {attachments.map((att, i) => (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: "4px",
                  background: "rgba(0, 120, 212, 0.1)",
                  border: "1px solid rgba(0, 120, 212, 0.3)",
                  borderRadius: "6px", padding: "2px 6px 2px 8px",
                  fontSize: "12px", color: tokens.colorNeutralForeground2,
                  maxWidth: "200px",
                }}
              >
                {att.kind === "image" ? "IMG" : att.kind === "pdf" ? "PDF" : "DOC"}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "120px" }}>{att.name}</span>
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<DismissRegular style={{ fontSize: "10px" }} />}
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  style={{ minWidth: "unset", padding: "0 2px", height: "16px" }}
                />
              </div>
            ))}
          </div>
        )}
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
