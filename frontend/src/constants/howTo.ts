import type { Mode } from "../types";

export interface HowToEntry {
  label: string;
  whatItDoes: string;
  howToUse: string[];
  outputs: string[];
}

export interface HowToSection {
  label: string;
  modes: Mode[];
}

// Order mirrors SideNav.NAV_SECTIONS so the drawer reads like a tour of the
// app. Entries cover every top-level item the user can click; desk-specialist
// sub-modes (NETWORK_DESK_MODES, COMPUTE_DESK_MODES, etc.) are summarized via
// their parent "desk" anchor entries to keep the drawer skim-able.
export const HOW_TO_SECTIONS: HowToSection[] = [
  {
    label: "Agents",
    modes: ["architect", "cost", "operations", "compliance", "engagement"],
  },
  {
    label: "Updates",
    modes: ["whatsnew", "servicehealth", "modellifecycle"],
  },
  {
    label: "Advise",
    modes: ["qa", "learningplan", "presentation"],
  },
  {
    label: "Plan",
    modes: ["intake", "intakechat", "analyze", "cost-optimize", "pricing-desk", "strategy"],
  },
  {
    label: "Design",
    modes: [
      "architecture",
      "landingzone",
      "demo-build",
      "namingstandards",
      "refarch",
      "showcase",
      "netvnet",
      "compsku",
      "datalake",
      "aifoundry",
    ],
  },
  {
    label: "Assess",
    modes: ["waf", "review", "threatmodel", "drbc", "reliability"],
  },
  {
    label: "Build & Run",
    modes: ["codegen", "pipelineforge", "runbookstudio", "troubleshoot"],
  },
  {
    label: "Skills",
    modes: ["skills", "skill-showcase"],
  },
  {
    label: "Reports",
    modes: ["modelmigration"],
  },
];

export const HOW_TO: Partial<Record<Mode, HowToEntry>> = {
  // ── Agents (unified) ──────────────────────────────────────────────────
  architect: {
    label: "Architect",
    whatItDoes:
      "The umbrella design agent. Picks the right Azure services for your workload, sketches the topology, writes Bicep, drafts diagrams, and grounds answers in Azure docs / AVM / reference architectures.",
    howToUse: [
      "Pick an Engagement in the header so your subscription, region, and compliance frameworks are in scope.",
      "Describe the workload — users, data, latency, regions, regulatory hits. The more specific, the better.",
      "Follow up with 'estimate cost', 'add HA across regions', or 'show the Bicep' to iterate.",
    ],
    outputs: [
      "Architecture narrative with grounded citations (Learn, AVM, ref archs).",
      "Cost estimate line items (RI-adjusted if the engagement declares commitments).",
      "Bicep / runbook artifacts attached to the chat for download.",
      "WAF pillar summary and diagrams (Mermaid + draw.io).",
    ],
  },
  cost: {
    label: "Cost & FinOps",
    whatItDoes:
      "FinOps agent. Live retail pricing, reservation/savings-plan break-even, right-sizing from real Azure Monitor metrics, carbon impact, and pay-as-you-go vs RI comparisons.",
    howToUse: [
      "Ask 'price a Standard_D8s_v5 in eastus2' or paste a cost estimate to optimize.",
      "Reference an engagement to apply its reservation commitments automatically.",
      "Request 'right-sizing recommendations' to pull P95 CPU from Azure Monitor.",
    ],
    outputs: [
      "Itemized monthly cost with retail prices and RI/SP adjustments.",
      "Reservation break-even months and recommended commitment tiers.",
      "Right-sizing recommendations with current vs proposed SKU + projected savings.",
      "Estimated kg CO₂ per month by region.",
    ],
  },
  operations: {
    label: "Operations",
    whatItDoes:
      "Reliability, troubleshoot, DR/BC, runbooks, monitoring, and service-health agent.",
    howToUse: [
      "Describe the failure mode, the SLO you want, or the runbook scenario you need.",
      "For incidents, paste error messages or KQL queries — the agent will diagnose and propose fixes.",
      "Ask for 'a runbook for VM not booting after patching' style scenarios.",
    ],
    outputs: [
      "Diagnostic reasoning with linked Microsoft Learn / Azure Updates citations.",
      "SLO/SLI design with target percentiles and error budgets.",
      "Step-by-step runbooks with rollback steps.",
      "Monitoring config (alerts, KQL queries, action groups).",
    ],
  },
  compliance: {
    label: "Compliance & Security",
    whatItDoes:
      "Security posture, threat modeling, DevSecOps, and compliance mapping (CIS, NIST, ISO, HIPAA, PCI, SOC2).",
    howToUse: [
      "Set the engagement's compliance_frameworks first — the agent uses them as the lens.",
      "Ask 'STRIDE this design' or 'map controls to NIST 800-53 moderate'.",
      "Request 'DevSecOps gates for this pipeline' to get pre-deploy checks.",
    ],
    outputs: [
      "Threat model with STRIDE categories and mitigations.",
      "Control mapping table (control → Azure service → evidence query).",
      "Pipeline gate recommendations (secret scans, IaC scans, SAST).",
    ],
  },
  engagement: {
    label: "Engagement Hub",
    whatItDoes:
      "Engagement-scoped agent for intake, RFPs, exec content, learning plans, and 'what's new for this customer' summaries.",
    howToUse: [
      "Pick an engagement (or create one) — every reply is grounded in that customer's subs and prefs.",
      "Ask 'draft a discovery questionnaire' or 'summarize this week's Azure updates for the customer'.",
    ],
    outputs: [
      "Discovery / intake questionnaires.",
      "Executive briefings filtered to the customer's services and regions.",
      "Learning plans tailored to the team's stated skill gaps.",
    ],
  },

  // ── Updates ───────────────────────────────────────────────────────────
  whatsnew: {
    label: "What's New",
    whatItDoes:
      "Daily-refreshed Azure announcements feed. Filterable by service and region. Can draft customer-facing emails from selected items.",
    howToUse: [
      "Browse the feed; filter by service tag or region.",
      "Select one or more items and click 'Draft email' to generate a customer-ready summary.",
    ],
    outputs: [
      "Card grid of announcements with publish date and freshness badge.",
      "Generated email draft (markdown) suitable for paste into Outlook.",
    ],
  },
  servicehealth: {
    label: "Service Health",
    whatItDoes:
      "Live Azure service health incidents and advisories scoped to the active engagement's subscriptions.",
    howToUse: [
      "Pick an engagement so the subscriptions are in scope.",
      "Filter by severity or region to find what's actually impacting you.",
    ],
    outputs: [
      "Incident list with impact, services, regions, last update.",
      "Active dot in SideNav when something needs attention.",
    ],
  },
  modellifecycle: {
    label: "Model Lifecycle",
    whatItDoes:
      "Azure Foundry model retirement schedule. Flags models you're using that are nearing end-of-life and proposes successors.",
    howToUse: [
      "Open the page — your in-use models (from telemetry) are highlighted.",
      "Click a model to see the official retirement date and recommended replacement.",
    ],
    outputs: [
      "Table of models with retirement dates and successor mapping.",
      "Migration scoring you can pipe into the Model IQ report.",
    ],
  },

  // ── Advise ────────────────────────────────────────────────────────────
  qa: {
    label: "Expert Advisor (Q&A)",
    whatItDoes:
      "Catch-all chat against 14 specialist advisors. Use this when the unified agents don't quite fit (e.g., cert prep, regional advisor, identity deep-dives).",
    howToUse: [
      "Pick the advisor flavor from the secondary menu (Cert Prep, Regional, Identity, etc.).",
      "Ask follow-ups; conversation history is saved per advisor.",
    ],
    outputs: [
      "Conversational answers with citations.",
      "Markdown export of any session.",
    ],
  },
  learningplan: {
    label: "Learning Plan",
    whatItDoes:
      "Builds structured Azure training plans with measurable outcomes, MS Learn paths, and milestone checkpoints.",
    howToUse: [
      "Describe the team's current skill level, target role, and timeframe.",
      "Refine the generated plan with 'add hands-on labs' or 'shorten to 4 weeks'.",
    ],
    outputs: [
      "Week-by-week plan with linked MS Learn modules.",
      "Outcomes / KPIs per phase.",
      "Markdown export for sharing.",
    ],
  },
  presentation: {
    label: "Presentation Coach",
    whatItDoes:
      "Structures an Azure topic into a deck outline for a specific audience (exec, IT pro, developer, customer), then builds a polished PPTX in your chosen light or dark theme.",
    howToUse: [
      "Coach tab: brainstorm structure, narrative, and talking points.",
      "Build Deck tab: set topic + audience, pick a light/dark theme and accent color, then generate.",
      "Review the AI's suggestions, then download the themed PPTX.",
    ],
    outputs: [
      "Slide outline with title + bullet points + speaker notes.",
      "World-class PPTX with a light or dark theme and your accent color.",
    ],
  },

  // ── Plan ──────────────────────────────────────────────────────────────
  intake: {
    label: "Requirements Studio",
    whatItDoes:
      "Structured form for workload requirements (users, data classification, latency, regions, budget, compliance). The captured spec is injected into every downstream design panel.",
    howToUse: [
      "Fill in what you know; leave the rest blank.",
      "Save the spec — it auto-populates Workload Analysis, Architecture, Cost Optimize, etc.",
    ],
    outputs: [
      "WorkloadSpec object persisted to localStorage.",
      "Spec snapshot attached to any design or analysis you run.",
    ],
  },
  intakechat: {
    label: "Guided Discovery",
    whatItDoes:
      "Conversational intake. The agent asks targeted questions where the spec has confidence gaps, then writes the spec for you.",
    howToUse: [
      "Start with one sentence about the workload.",
      "Answer the questions it asks; skip with 'I don't know' if needed.",
    ],
    outputs: [
      "Same WorkloadSpec as Requirements Studio, plus a confidence score per field.",
    ],
  },
  analyze: {
    label: "Workload Analysis",
    whatItDoes:
      "One click runs architecture + sizing + security + WAF in parallel, then bundles them into a single design artifact with cost estimate, diagrams, and citations.",
    howToUse: [
      "Have a WorkloadSpec ready (or fill the requirements box inline).",
      "Click Run; watch the SSE timeline. Each phase streams live.",
      "Use Resume if you closed the tab mid-run.",
    ],
    outputs: [
      "BundledDesign with architecture text, sizing, security findings, WAF pillars, cost estimate, diagrams.",
      "Saved to localStorage under azure_saved_designs.",
    ],
  },
  "cost-optimize": {
    label: "Cost Optimize",
    whatItDoes:
      "Deterministic 7-phase cost pipeline: ingest → enrich → reservations → right-sizing → carbon → narrative → report. Streams progress per phase.",
    howToUse: [
      "Provide a cost estimate (paste, upload, or pull from a saved design).",
      "Run the pipeline; each phase shows progress + intermediate results.",
    ],
    outputs: [
      "Optimized cost estimate with RI adjustments and right-sized SKUs.",
      "Narrated report explaining each recommendation.",
      "Carbon delta (current vs optimized).",
    ],
  },
  "pricing-desk": {
    label: "Pricing Desk",
    whatItDoes:
      "Conversational pricing for ANY Azure service (not just VMs). Describe what you need priced and a live, exportable worksheet builds on the right, priced across every billing meter via the Azure Retail Pricing API.",
    howToUse: [
      "Describe what to price, e.g. '3× D8s_v5 in West Europe and 5 TB hot blob storage'.",
      "Iterate in chat — add lines, change regions, or switch to reservations; the worksheet updates.",
      "Ask 'where is this cheaper?' to see per-region availability and one-click re-price.",
      "Click Export to Excel for a worksheet + recommendations workbook.",
    ],
    outputs: [
      "Meter-level pricing worksheet with per-line subtotals and a grand total.",
      "Cost-savings recommendations (reservations, right-sizing, region/tier swaps).",
      "Region availability comparison for selected SKUs.",
      "Excel (.xlsx) export.",
    ],
  },
  strategy: {
    label: "Strategy Builder",
    whatItDoes:
      "Generates an Azure adoption strategy document with phases, workstreams, and success metrics for a stated business goal.",
    howToUse: [
      "Describe the business outcome and current state.",
      "Refine with 'add a 12-month migration timeline' or 'increase emphasis on AI workloads'.",
    ],
    outputs: [
      "Strategy doc (markdown) with phases, RACI, and metrics.",
    ],
  },

  // ── Design ────────────────────────────────────────────────────────────
  architecture: {
    label: "Architecture Design",
    whatItDoes:
      "Deep design surface for full architectures, AI architectures, data platforms, APIM, and network topologies. Combines streaming chat with diagram rendering and Bicep output.",
    howToUse: [
      "Pick the sub-mode (Architecture, AI, Data, APIM, Network) in the breadcrumb.",
      "Describe the workload or paste a spec.",
      "Click 'Generate diagram' or 'Generate Bicep' from the artifact toolbar.",
    ],
    outputs: [
      "Architecture narrative + grounded citations.",
      "Mermaid + draw.io diagrams.",
      "Bicep module(s) ready to push to a repo.",
    ],
  },
  landingzone: {
    label: "Landing Zone",
    whatItDoes:
      "Azure CAF-aligned landing zone design: management group hierarchy, policies, networking topology, identity foundation.",
    howToUse: [
      "Specify org size, compliance posture, and hub/spoke vs vWAN preference.",
      "Iterate on management group structure and policy assignments.",
    ],
    outputs: [
      "Management group diagram.",
      "Policy assignment list.",
      "Bicep for the foundation (subscriptions, RGs, VNets).",
    ],
  },
  "demo-build": {
    label: "Demo Builder",
    whatItDoes:
      "Generates a clone-and-run Azure AI demo end-to-end: code (Flask/FastAPI/SSE) + Bicep + docs + diagrams. Parallel build lanes with per-phase model routing.",
    howToUse: [
      "Fill demo slug, title, audience, duration, persona, key features, Azure services.",
      "Hit Build; watch lanes (code / infra / docs) progress in parallel.",
      "Toggle Publish to push to GitHub (gated by DEMO_FACTORY_PUBLISH env).",
    ],
    outputs: [
      "Manifest of files: app.py, requirements.txt, infra/main.bicep, README.md, ARCHITECTURE.md, etc.",
      "Mermaid diagrams extracted from the design.",
      "Verification report from az bicep build.",
    ],
  },
  namingstandards: {
    label: "Naming Standards",
    whatItDoes:
      "CAF naming convention generator. Outputs the pattern + a Bicep/Terraform enforcement module you can drop into a landing zone.",
    howToUse: [
      "Pick org abbreviation, environment list, and resource scopes.",
    ],
    outputs: [
      "Naming pattern table (resource type → format).",
      "Enforcement module (Bicep or Terraform).",
    ],
  },
  refarch: {
    label: "Reference Architectures",
    whatItDoes:
      "Browser of official Microsoft reference architectures plus any custom entries your org has ingested.",
    howToUse: [
      "Search or filter by service / pattern.",
      "Click an entry to view the canonical diagram and source link.",
    ],
    outputs: [
      "Architecture cards with diagram + summary + source URL.",
    ],
  },
  showcase: {
    label: "Demo Showcase",
    whatItDoes:
      "Catalog of demos built with the Demo Builder. Can be browsed, cloned, or contributed back.",
    howToUse: [
      "Search by tag or service; click into a demo to see its manifest.",
    ],
    outputs: [
      "Demo cards with repo URL, screenshots, and build manifest.",
    ],
  },
  netvnet: {
    label: "Network Desk",
    whatItDoes:
      "11 specialist advisors for Azure networking: VNet, firewall, security, hybrid, private link, vWAN, DNS, monitoring, troubleshoot, IaC, pricing.",
    howToUse: [
      "Pick a specialist; ask scoped questions (each has its own context).",
    ],
    outputs: [
      "Specialist answers + citations + diagrams.",
    ],
  },
  compsku: {
    label: "Compute Desk",
    whatItDoes:
      "10 specialist advisors for Azure compute: SKU selection, scale, disks, HA/DR, performance tuning, monitoring, troubleshoot, security, cost.",
    howToUse: [
      "Pick the specialist matching your problem.",
    ],
    outputs: [
      "Targeted recommendations + Azure CLI commands + cost notes.",
    ],
  },
  datalake: {
    label: "Data Desk",
    whatItDoes:
      "Data platform specialists (lake, warehouse, streaming, lakehouse, governance, security, migration, cost, quality, IaC) plus Fabric / ADF / medallion tools.",
    howToUse: [
      "Pick the matching specialist or pipeline tool.",
    ],
    outputs: [
      "Architecture recommendations, pipeline JSON/YAML, medallion schemas.",
    ],
  },
  aifoundry: {
    label: "AI Desk",
    whatItDoes:
      "10 specialist advisors for Azure AI: Foundry, model selection, RAG, agents, fine-tuning, MLOps, eval, safety, cost, IaC.",
    howToUse: [
      "Pick the specialist relevant to your AI workload.",
    ],
    outputs: [
      "AI architecture recommendations, model picks, eval plans, safety controls.",
    ],
  },

  // ── Assess ────────────────────────────────────────────────────────────
  waf: {
    label: "WAF Assessment",
    whatItDoes:
      "Scores an architecture against all 5 Well-Architected Framework pillars (reliability, security, cost, operational excellence, performance).",
    howToUse: [
      "Paste an architecture description or pull a saved design.",
      "Review per-pillar score + findings.",
    ],
    outputs: [
      "Pillar scores (1–5) with rationale.",
      "Findings list with severity and recommended actions.",
    ],
  },
  review: {
    label: "Architecture Review",
    whatItDoes:
      "Red-team review — the agent argues against your design, finds gaps, single points of failure, and missing controls.",
    howToUse: [
      "Paste the design or load a saved one.",
      "Address findings; re-run to confirm gaps closed.",
    ],
    outputs: [
      "Findings list (severity, category, evidence, recommendation).",
    ],
  },
  threatmodel: {
    label: "Threat Model",
    whatItDoes:
      "STRIDE analysis: spoofing, tampering, repudiation, info disclosure, DoS, elevation. Maps to Azure controls.",
    howToUse: [
      "Paste system diagram description; identify trust boundaries.",
    ],
    outputs: [
      "STRIDE table per component with threats + mitigations.",
      "Attack surface summary.",
    ],
  },
  drbc: {
    label: "DR/BC Design",
    whatItDoes:
      "Recovery strategies (active-active, active-passive, pilot light, backup-restore) with failover runbooks and RTO/RPO targets.",
    howToUse: [
      "Specify RTO/RPO targets and tolerated cost.",
    ],
    outputs: [
      "DR strategy + region pairing + replication design.",
      "Failover and failback runbooks.",
    ],
  },
  reliability: {
    label: "Reliability & SLO",
    whatItDoes:
      "SLO design, FMEA, chaos experiments, and toil inventory.",
    howToUse: [
      "Describe the user journey; the agent proposes SLIs / SLOs.",
      "Ask for 'chaos experiments to validate the failover SLO'.",
    ],
    outputs: [
      "SLI/SLO table with measurement queries.",
      "FMEA table.",
      "Chaos experiment scripts.",
    ],
  },

  // ── Build & Run ───────────────────────────────────────────────────────
  codegen: {
    label: "Code Generator",
    whatItDoes:
      "Generates application code with Copilot-style scaffolds (Python/TS) and optionally pushes to a GitHub repo.",
    howToUse: [
      "Describe the feature; specify language and framework.",
      "Review streamed code; click Push to commit to a new branch.",
    ],
    outputs: [
      "File-by-file streamed code with explanations.",
      "Optional GitHub PR.",
    ],
  },
  pipelineforge: {
    label: "Pipeline Forge",
    whatItDoes:
      "Generates GitHub Actions and Azure DevOps CI/CD pipelines wired to a target Azure environment.",
    howToUse: [
      "Specify build tooling, deploy target, environments (dev/stage/prod).",
    ],
    outputs: [
      ".github/workflows/*.yml or azure-pipelines.yml ready to commit.",
    ],
  },
  runbookstudio: {
    label: "Runbook Studio",
    whatItDoes:
      "Generates SRE runbooks for Azure failure scenarios (region failover, identity outage, key rotation, etc.).",
    howToUse: [
      "Pick a scenario or describe one in free text.",
    ],
    outputs: [
      "Step-by-step runbook with preconditions, detection, mitigation, validation, rollback.",
    ],
  },
  troubleshoot: {
    label: "Troubleshoot",
    whatItDoes:
      "Diagnoses Azure issues from error messages, KQL output, or symptom descriptions and proposes fixes.",
    howToUse: [
      "Paste the error / log / KQL result; describe what you tried.",
    ],
    outputs: [
      "Diagnostic reasoning chain.",
      "Recommended remediation with commands.",
    ],
  },

  // ── Reports ───────────────────────────────────────────────────────────
  modelmigration: {
    label: "Model IQ",
    whatItDoes:
      "Scores model migrations (e.g., gpt-4 → gpt-5.4) on quality, cost, latency, and safety. Plans PTU capacity for the target.",
    howToUse: [
      "Pick source and target models; provide token volume and traffic shape.",
      "Review the side-by-side scorecard and the PTU capacity plan.",
    ],
  // ── Skills ────────────────────────────────────────────────────────────
  skills: {
    label: "My Skills",
    whatItDoes:
      "Your personal library of Custom Skills — declarative, code-free skill packages that inject expert instructions (and optional grounding knowledge) into the assistant. Upload your own, enable/disable them, run them, and publish the good ones to the Skill Showcase.",
    howToUse: [
      "Click 'Upload skill' and drop a skill package .zip (skill.yaml + instructions.md, optionally inputs, knowledge, examples). Not sure how? 'Download sample' gives you a ready-to-edit starter.",
      "Toggle a skill on to make the assistant use it; fill any declarative input fields the skill defines, then run it from chat.",
      "Use 'Publish' to share a skill into the Skill Showcase for your whole org.",
    ],
    outputs: [
      "An installed, versioned skill you can enable, run, export as a .zip, or delete.",
      "Assistant answers shaped by the skill's instructions and grounded in its knowledge files.",
    ],
  },
  "skill-showcase": {
    label: "Skill Showcase",
    whatItDoes:
      "The org-wide catalog of shareable skill packages (mirrors the Demo Showcase). Browse curated and community skills — like the CAF Naming Standards skill — and install any of them into My Skills with one click.",
    howToUse: [
      "Browse the catalog (featured and most-installed first) and read each skill's description and tags.",
      "Click 'Install' to copy a skill into My Skills as your own editable copy.",
      "Enable it under My Skills and run it; tweak the instructions or inputs to fit your org.",
    ],
    outputs: [
      "A freshly installed, user-owned copy of the chosen skill under My Skills.",
      "Install counts that surface the most useful skills to everyone.",
    ],
  },
};
