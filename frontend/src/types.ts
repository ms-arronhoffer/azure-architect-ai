export type Mode =
  | "qa"
  | "architecture"
  | "reference"
  | "compare"
  | "waf"
  | "review"
  | "compliance"
  | "migration"
  | "regional"
  | "cost"
  | "drbc"
  | "monitoring"
  | "situation"
  | "presentation"
  | "certprep"
  | "learningplan"
  | "codegen"
  | "pipelineforge"
  | "runbookstudio"
  | "namingstandards"
  | "aiarchitecture"
  | "dataplatform"
  | "apim"
  | "network"
  | "landingzone"
  | "identity"
  | "threatmodel"
  | "devsecops"
  | "reliability"
  | "security"
  | "governance"
  | "ops"
  | "intake"
  | "intakechat"
  | "analyze"
  | "cost-optimize"
  | "pricing-desk"
  | "troubleshoot"
  | "whatsnew"
  | "servicehealth"
  | "modellifecycle"
  | "strategy"
  | "datapipelineadvisor"
  | "fabricplanner"
  | "adfpipeline"
  | "medalliondesigner"
  | "modelmigration"
  | "showcase"
  | "demo-build"
  | "refarch"
  | "netvnet"
  | "netfirewall"
  | "netsecurity"
  | "nethybrid"
  | "netprivatelink"
  | "netvwan"
  | "netdns"
  | "netmonitor"
  | "nettroubleshoot"
  | "netiac"
  | "netpricing"
  | "compsku"
  | "compscale"
  | "compdisk"
  | "compha"
  | "compdr"
  | "compperf"
  | "compmonitor"
  | "comptroubleshoot"
  | "compsecurity"
  | "compcost"
  | "aifoundry"
  | "aimodel"
  | "airag"
  | "aiagents"
  | "aifinetune"
  | "aimlops"
  | "aieval"
  | "aisafety"
  | "aicost"
  | "aiiac"
  | "datalake"
  | "datawarehouse"
  | "datastream"
  | "datalakehouse"
  | "datagovernance"
  | "datasecurity"
  | "datamigration"
  | "datacost"
  | "dataquality"
  | "dataiac"
  | "admin"
  // Theme 4 — unified agent identifiers. "cost" and "compliance" already exist
  // above as legacy mode names; the backend treats them as the agent tokens of
  // the same name, so we only add the three new ones here.
  | "architect"
  | "operations"
  | "engagement"
  // Unified single front door — posts to /api/chat without pre-selecting an
  // agent so the backend router classifies and dispatches.
  | "ask";

// ── Demo showcase ────────────────────────────────────────────────────────────

export interface Demo {
  id: string;
  title: string;
  description: string;
  tags: string[];
  video_url: string | null;
  repo_url: string | null;
  live_url: string | null;
  thumbnail_url: string | null;
  featured: boolean;
  created_at: string;
  source?: "microsoft_official" | "community" | "custom";
  last_synced_at?: string | null;
}

// ── Strategy Builder ─────────────────────────────────────────────────────────

export interface StrategicPillar {
  name: string;
  description: string;
  rationale: string;
}

export interface CapabilityRow {
  capability_area: string;
  azure_services: string[];
  justification: string;
  alternatives: string[];
}

export interface StrategyWafAlignment {
  status: "Strong" | "Adequate" | "Gap";
  score: number;
  recommendations: string[];
}

export interface RiskItem {
  risk: string;
  category: string;
  impact: "H" | "M" | "L";
  likelihood: "H" | "M" | "L";
  mitigation: string;
}

export interface StrategyReference {
  title: string;
  url: string;
}

export interface RoadmapPhase {
  phase: string;
  focus: string;
  key_initiatives: string[];
  success_metrics: string[];
}

export interface StrategyResult {
  executive_summary: string;
  strategic_pillars: StrategicPillar[];
  capability_map: CapabilityRow[];
  waf_alignment: {
    reliability: StrategyWafAlignment;
    security: StrategyWafAlignment;
    cost_optimization: StrategyWafAlignment;
    operational_excellence: StrategyWafAlignment;
    performance_efficiency: StrategyWafAlignment;
    overall_score?: number;
  };
  risk_register: RiskItem[];
  strategic_roadmap?: RoadmapPhase[];
  references: StrategyReference[];
}

// ── What's New ───────────────────────────────────────────────────────────────

export interface Announcement {
  id: string;
  title: string;
  description: string;
  url: string;
  pub_date: string;
  source: string;
  source_label: string;
}

// ── Navigation ──────────────────────────────────────────────────────────────

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface NavItem {
  mode: Mode;
  label: string;
  icon: string; // icon name key
  description: string;
}

// ── Core chat types ──────────────────────────────────────────────────────────

export interface Citation {
  title: string;
  url: string;
  description: string;
  // Theme 1 — citation provenance. All optional so the UI handles both
  // RAG-backed citations (with these fields) and live Learn fallback (without).
  corpus?: string;
  corpus_type?: string;
  published_at?: string;
  freshness_days?: number;
  confidence?: number;
  version?: string;
  module_path?: string;
  // Theme 2 — reranker rationale ("why this passage answers the query").
  reason?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  isStreaming?: boolean;
  structuredResult?: StructuredResult;
}

// ── Architecture types ───────────────────────────────────────────────────────

export interface ArchComponent {
  id: string;
  label: string;
  shape: string;
  category?: string;
  tier?: number;
  x?: number;
  y?: number;
}

export interface ArchConnection {
  from: string;
  to: string;
  label?: string;
}

export interface ArchResult {
  diagramXml: string | null;
  runbookMarkdown: string | null;
  bicepCode: string | null;
  explanation: string;
  citations: Citation[];
}

// ── WAF types ────────────────────────────────────────────────────────────────

export interface WafRecommendationCitation {
  text: string;
  learn_url?: string;
  source?: string;
  confidence?: number;
}

export interface WafPillarResult {
  pillar: string;
  score: number;
  findings: string[];
  recommendations: (string | WafRecommendationCitation)[];
}

export interface WafResult {
  pillars: WafPillarResult[];
}

// ── Cost estimation types ────────────────────────────────────────────────────

export interface CostLineItem {
  service: string;
  sku: string;
  region: string;
  quantity: number;
  unit_price: number | null;
  unit_of_measure: string;
  monthly_estimate: number | null;
  currency: string;
  note?: string;
  requested_sku?: string;
  sku_swapped?: boolean;
  sku_status?: "unknown";
  source?: string;
  matched_sku?: string;
  confidence?: number | null;
  low_confidence?: boolean;
  meter_name?: string;
  product_name?: string;
  resolver_source?: string;
  candidates?: Array<{
    sku?: string;
    meter_name?: string;
    product_name?: string;
    unit_price?: number | null;
    score?: number | null;
  }>;
}

export interface SkuValidationSummary {
  total_lines: number;
  swapped: number;
  missing: number;
  data_source: string;
  last_queried_at: string;
}

export interface CostEstimate {
  line_items: CostLineItem[];
  total_monthly_estimate: number;
  currency: string;
  disclaimer: string;
  optimization_tips?: string[];
  sku_validation?: SkuValidationSummary;
}

// ── Pricing Desk types (meter-aware worksheet) ───────────────────────────────

export interface PricedMeter {
  dimension?: string;
  label?: string;
  unit?: string;
  quantity?: number;
  included_free?: number;
  billable_quantity?: number;
  unit_price?: number | null;
  unit_of_measure?: string | null;
  monthly_cost?: number | null;
  meter_id?: string | null;
  meter_name?: string | null;
  currency?: string;
  priced?: boolean;
  source?: string;
  note?: string;
  confidence?: number;
  confidence_label?: "high" | "medium" | "low" | "none";
  citation?: {
    meter_id?: string | null;
    meter_name?: string | null;
    sku_name?: string | null;
    product_name?: string | null;
    region?: string;
    unit_price?: number | null;
    unit_of_measure?: string | null;
    currency?: string;
    retrieved_at?: string;
    source?: string;
  };
}

export interface PricedLine {
  service: string;
  display_name?: string;
  category?: string;
  sku?: string;
  region?: string;
  catalog_matched?: boolean;
  discovered?: boolean;
  ri_eligible?: boolean;
  tags?: string[];
  meters: PricedMeter[];
  monthly_subtotal: number;
  currency: string;
  confidence?: number;
  confidence_label?: "high" | "medium" | "low" | "none";
  assumptions?: string[];
  note?: string;
  source?: string;
  // Present when an engagement reservation was applied.
  original_monthly_estimate?: number;
  reservation_applied?: {
    commit_key: string;
    covered_quantity: number;
    discount_rate: number;
    monthly_savings: number;
  };
}

// Accounts for every node extracted from the architecture: priced, free, or
// unpriced-with-reason — so the user can trust the total is whole.
export interface CompletenessReport {
  components_found: number;
  priceable: number;
  priced: number;
  not_billable: Array<{ name: string; reason: string }>;
  unknown: Array<{ name: string; reason: string }>;
  unpriced: Array<{ name: string; reason: string }>;
  fully_accounted: boolean;
}

export interface PricedWorksheet {
  line_items: PricedLine[];
  total_monthly_estimate: number;
  currency: string;
  summary?: {
    total_lines: number;
    catalog_matched: number;
    unpriced_meters: number;
    discovered?: number;
    low_confidence_lines?: number;
  };
  data_source?: string;
  disclaimer?: string;
  optimization_tips?: string[];
  completeness?: CompletenessReport;
  extraction?: { source: string; component_count: number; notes?: string[] };
  reservation_adjustments?: Array<{
    service: string;
    sku: string;
    commit_key: string;
    covered_quantity: number;
    monthly_savings: number;
  }>;
  reservation_monthly_savings?: number;
}

export interface RegionAvailabilityRow {
  region: string;
  available: boolean;
  unit_price: number | null;
  unit_of_measure: string | null;
  sku: string;
  currency: string;
  cheapest?: boolean;
  note?: string;
}

export interface RegionAvailability {
  service: string;
  requested_sku: string;
  currency: string;
  regions: RegionAvailabilityRow[];
  available_count: number;
  total_regions: number;
  cheapest_region: string | null;
  source: string;
}

// ── Cheaper-equivalent SKU alternatives (suggest_alternatives) ───────────────

export interface CostAlternativeRow {
  sku: string;
  requested_sku?: string;
  region: string;
  monthly_estimate: number | null;
  unit_price?: number | null;
  delta_vs_baseline: number | null;
  savings_pct: number | null;
  cheaper: boolean;
  rule_id?: string;
  rationale?: string;
  tradeoff?: string;
  est_savings_pct?: number | null;
}

export interface CostAlternatives {
  service: string;
  baseline: {
    sku: string;
    requested_sku?: string;
    region: string;
    monthly_estimate: number | null;
    unit_price?: number | null;
  };
  alternatives: CostAlternativeRow[];
  alternative_count: number;
  cheaper_count: number;
  currency: string;
  source: string;
}

// ── Clarifying questions (request_clarification) ─────────────────────────────

export interface ClarificationQuestion {
  question: string;
  options?: string[];
  why_it_matters?: string;
  allow_free_text?: boolean;
}

export interface ClarificationRequest {
  questions: ClarificationQuestion[];
  known_so_far?: Record<string, unknown>;
  context?: string;
}

// ── Monitoring config types ──────────────────────────────────────────────────

export interface AlertRule {
  name: string;
  resource_type?: string;
  metric_or_kql: string;
  threshold: string;
  severity: number;
  description?: string;
}

export interface KqlQuery {
  name: string;
  query: string;
  description?: string;
}

export interface MonitoringConfig {
  alert_rules: AlertRule[];
  kql_queries: KqlQuery[];
  dashboard_widgets?: string[];
  bicep_alerts?: string;
}

// ── Compliance types ─────────────────────────────────────────────────────────

export interface ComplianceGap {
  control: string;
  gap: string;
  remediation: string;
  azure_service?: string;
}

export interface ComplianceResult {
  framework: string;
  controls_met: string[];
  gaps: ComplianceGap[];
  azure_policy_recommendations: string[];
  shared_responsibility_notes?: string;
}

// ── Migration types ──────────────────────────────────────────────────────────

export interface MigrationAssessment {
  workload_name: string;
  current_state: string;
  strategy: string;
  rationale: string;
  target_azure_services: string[];
  effort_weeks?: number;
  risk_level: string;
  wave?: number;
  key_steps: string[];
  blockers: string[];
}

// ── DR types ─────────────────────────────────────────────────────────────────

export interface DrServiceConfig {
  service: string;
  dr_approach: string;
  rpo_achieved?: string;
  azure_feature?: string;
}

export interface DrStrategy {
  dr_pattern: string;
  primary_region: string;
  secondary_region: string;
  service_configs: DrServiceConfig[];
  failover_steps: string[];
  test_plan: string[];
  estimated_monthly_dr_cost?: string;
}

// ── Service comparison types ──────────────────────────────────────────────────

export interface ComparisonRow {
  dimension: string;
  values: Record<string, string>;
}

export interface ServiceComparison {
  services: string[];
  use_case: string;
  comparison_rows: ComparisonRow[];
  recommendation: string;
  decision_tree: string[];
}

// ── ADR types ─────────────────────────────────────────────────────────────────

export interface AdrRecord {
  title: string;
  status: "Proposed" | "Accepted" | "Deprecated";
  context: string;
  decision: string;
  consequences: string;
  alternatives?: string[];
}

// ── Bicep / IaC types ────────────────────────────────────────────────────────

export interface BicepResult {
  bicep_code: string;
  param_file?: string;
  deploy_commands: string[];
  notes: string[];
}

// ── Reference architecture catalog ───────────────────────────────────────────

export interface ReferenceArch {
  id: string;
  title: string;
  category: string;
  tags: string[];
  description: string;
  services: string[];
  waf_score: Record<string, number>;
  patterns: string[];
  learn_url: string;
  complexity: "Low" | "Medium" | "High";
  estimated_monthly: string | Record<string, number>;
  slug?: string;
  summary?: string;
  repo_url?: string | null;
  bicep_avm_module?: string | null;
  diagram_url?: string | null;
  source?: "microsoft_official" | "community" | "custom";
  featured?: boolean;
  created_at?: string;
  last_synced_at?: string | null;
}

// ── Learning plan types ───────────────────────────────────────────────────────

export interface LearningModule {
  session_label: string;
  title: string;
  duration_hours?: number;
  description: string;
  topics: string[];
  skills_taught: string[];
  activities?: string[];
}

export interface LearningPlan {
  title: string;
  overview: string;
  target_audience: string;
  duration_days: number;
  prerequisites: string[];
  learning_outcomes: string[];
  modules: LearningModule[];
}

// ── Network topology types ────────────────────────────────────────────────────

export interface VNetSubnet {
  name: string;
  cidr: string;
  purpose?: string;
}

export interface VNet {
  name: string;
  cidr: string;
  region?: string;
  subnets: VNetSubnet[];
}

export interface NsgRule {
  name: string;
  priority: number;
  direction: "Inbound" | "Outbound";
  action: "Allow" | "Deny";
  source: string;
  destination: string;
  port: string;
  protocol: string;
}

export interface PrivateEndpoint {
  resource: string;
  subnet: string;
  private_dns_zone: string;
}

export interface NetworkTopology {
  topology_type: string;
  vnets: VNet[];
  nsg_rules: NsgRule[];
  private_endpoints: PrivateEndpoint[];
  dns_design?: string;
  firewall?: string;
  diagramXml?: string;
}

// ── Landing zone types ────────────────────────────────────────────────────────

export interface ManagementGroup {
  name: string;
  level: number;
  parent_id?: string;
  children?: ManagementGroup[];
}

export interface LandingZoneDesign {
  management_groups: ManagementGroup[];
  policy_initiatives: string[];
  naming_convention: string;
  mandatory_tags: Record<string, string>;
  rbac_assignments: Array<{ principal: string; role: string; scope: string }>;
  subscription_vending?: string;
}

// ── RBAC / identity model types ───────────────────────────────────────────────

export interface RoleAssignment {
  principal: string;
  role: string;
  scope: string;
  type: "Active" | "PIM-Eligible";
}

export interface ConditionalAccessPolicy {
  name: string;
  conditions: string;
  grant_controls: string;
}

export interface RbacModel {
  principals: string[];
  role_assignments: RoleAssignment[];
  custom_roles: Array<{ name: string; permissions: string[] }>;
  conditional_access_policies: ConditionalAccessPolicy[];
  pim_settings?: string;
  workload_federation?: string;
}

// ── Threat register types ─────────────────────────────────────────────────────

export interface Threat {
  id: string;
  title: string;
  stride_category: string;
  likelihood: number;
  impact: number;
  risk_score: number;
  mitigations: string[];
  azure_controls: string[];
  status: "Open" | "Mitigated" | "Accepted";
}

export interface ThreatRegister {
  trust_boundaries: string[];
  attack_surface: string[];
  threats: Threat[];
  security_controls_recommended: string[];
}

// ── Pipeline design types ─────────────────────────────────────────────────────

export interface PipelineJob {
  name: string;
  is_security_gate: boolean;
  steps?: string[];
}

export interface PipelineStage {
  name: string;
  jobs: PipelineJob[];
}

export interface SecurityScan {
  type: "SAST" | "DAST" | "SCA" | "IaC" | "Container";
  tool: string;
  blocking: boolean;
}

export interface PipelineDesign {
  platform: string;
  branch_strategy: string;
  stages: PipelineStage[];
  security_scans: SecurityScan[];
  workload_identity: string;
  secrets_management: string;
}

// ── SLO framework types ───────────────────────────────────────────────────────

export interface SloService {
  name: string;
  azure_sla: string;
  customer_slo: string;
  sli_definition: string;
  error_budget_minutes: number;
}

export interface BurnRateAlert {
  window: string;
  burn_rate: number;
  description: string;
}

export interface SloFramework {
  services: SloService[];
  composite_sla: string;
  error_budget_alerts: BurnRateAlert[];
  toil_inventory: string[];
  chaos_experiments: string[];
}

// ── SKU recommendation types ──────────────────────────────────────────────────

export interface SkuAlternative {
  sku: string;
  trade_off: string;
  monthly_delta: number;
}

export interface SkuRecommendationItem {
  component: string;
  recommended_sku: string;
  vcpu?: number;
  memory_gb?: number;
  reasoning: string;
  utilization_target?: string;
  alternatives: SkuAlternative[];
  autoscale?: { min: number; max: number; scale_trigger: string };
}

export interface SkuRecommendation {
  workload_profile: {
    peak_users?: number;
    avg_rps?: number;
    data_volume_gb?: number;
    latency_p99_ms?: number;
    availability_target?: string;
  };
  recommendations: SkuRecommendationItem[];
  sizing_assumptions: string[];
  warnings: string[];
}

// ── Workload context ──────────────────────────────────────────────────────────

export interface WorkloadContext {
  region: string;
  complianceFramework: string;
  budgetRange: string;
  teamSize: string;
  notes: string;
}

// ── Workload spec (Requirements Studio) ──────────────────────────────────────

export type WorkloadType = "web-app" | "microservices" | "data-pipeline" | "ml" | "event-driven" | "other";
export type WorkloadCriticality = "mission-critical" | "high" | "standard" | "dev-test";
export type AvailabilitySla = "99.9" | "99.95" | "99.99";
export type DataClassification = "public" | "internal" | "confidential" | "restricted";
export type IdentityModel = "workforce" | "b2c" | "both" | "service-to-service";
export type CloudMaturity = "greenfield" | "migrating" | "modernizing" | "optimizing";

export interface WorkloadSpec {
  name: string;
  type: WorkloadType;
  criticality: WorkloadCriticality;
  businessOwner: string;
  peakUsers: number;
  avgRps: number;
  dataVolumeGb: number;
  latencyP99Ms: number;
  availabilitySla: AvailabilitySla;
  rtoHours: number;
  rpoHours: number;
  multiRegion: boolean;
  primaryRegion: string;
  drRegion: string;
  complianceFrameworks: string[];
  dataClassification: DataClassification;
  identityModel: IdentityModel;
  networkIsolation: boolean;
  monthlyBudgetUsd: number;
  teamSize: string;
  cloudMaturity: CloudMaturity;
  currentInfrastructure: string;
  existingServices: string[];
  integrations: string;
  migrationTimeline: string;
  regulatoryNotes: string;
  additionalNotes: string;
}

// ── Region comparison types ───────────────────────────────────────────────────

export interface RegionComparisonRow {
  region_name: string;
  geography: string;
  az_count: number;
  data_residency: string;
  paired_region: string;
  latency_tier: string;
  cost_delta: string;
  compliance_certs: string[];
  key_services_available: string[];
}

export interface RegionComparison {
  regions: RegionComparisonRow[];
  recommendation: string;
  notes?: string[];
}

// ── Practice exam types ───────────────────────────────────────────────────────

export interface PracticeQuestion {
  question: string;
  choices: { A: string; B: string; C: string; D: string };
  correct: "A" | "B" | "C" | "D";
  explanation: string;
  domain: string;
}

export interface PracticeExamPack {
  exam: string;
  questions: PracticeQuestion[];
}

// ── Stakeholder communication plan types ─────────────────────────────────────

export interface StakeholderAudience {
  name: string;
  talking_points: string[];
  objections_and_responses: Array<{ objection: string; response: string }>;
}

export interface StakeholderPlan {
  situation_summary: string;
  audiences: StakeholderAudience[];
  recommended_actions: string[];
  timeline?: string;
}

// ── Decision card types ───────────────────────────────────────────────────────

export interface DecisionCard {
  recommendation: string;
  rationale: string;
  tradeoffs: Array<{ aspect: string; detail: string }>;
  when_to_reconsider: string[];
}

// ── ARB (Architecture Review Board) ──────────────────────────────────────────

export type ArbStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "approved_with_conditions"
  | "rejected"
  | "withdrawn";

export type ArbConditionStatus = "open" | "in_progress" | "cleared" | "waived";
export type ArbConditionSeverity = "blocker" | "major" | "minor";

export interface ArbCondition {
  id: string;
  submission_id: string;
  text: string;
  severity: ArbConditionSeverity;
  status: ArbConditionStatus;
  owner: string | null;
  due_date: number | null;
  evidence_url: string | null;
  cleared_at: number | null;
  cleared_by: string | null;
  notes: string | null;
}

export interface ArbSubmission {
  id: string;
  engagement_id: string;
  title: string;
  submitted_by: string;
  submitted_at: number;
  status: ArbStatus;
  bundled_design_snapshot: Record<string, unknown>;
  citation_snapshot: Citation[];
  inventory_snapshot_at: number | null;
  reviewer_packet_url: string | null;
  decision_summary: string | null;
  decided_at: number | null;
  decided_by: string | null;
  conditions?: ArbCondition[];
}

export interface ArbSubmissionProposal {
  title: string;
  summary?: string;
  conditions?: Array<{
    text: string;
    severity: ArbConditionSeverity;
    owner?: string;
  }>;
}

export interface ArbConditionActionPayload {
  condition_id: string;
  evidence_url?: string;
  notes?: string;
  rationale?: string;
}

export interface ArbStatusTransitionProposal {
  submission_id: string;
  target_status: Exclude<ArbStatus, "draft">;
  decision_summary?: string;
}



// ── Architecture-route SSE result types ──────────────────────────────────────

export interface TerraformFilesResult {
  files: Record<string, string>;
  pattern_name?: string;
  notes?: string[];
}

export interface ArmFilesResult {
  files: Record<string, string>;
  pattern_name?: string;
  notes?: string[];
}

export interface CicdFilesResult {
  platform: string;            // "github" | "azure_devops" (route emits literal "github" or "azure_devops")
  files: Record<string, string>;
  pattern_name?: string;
  environment?: string;
  deploy_method?: string;
}

export interface CostAlertsResult {
  subscription_id?: string;
  monthly_budget_usd?: number;
  thresholds?: number[];
  bicep?: string;
  resources?: string[];
  deploy_command?: string;
  error?: string;
}

export interface SecurityPostureFinding {
  id?: string;
  title?: string;
  severity?: string;
  status?: string;
  resource?: string;
  remediation?: string;
  [key: string]: unknown;
}

export interface SecurityPostureRecommendation {
  id?: string;
  display_name?: string;
  severity?: string;
  category?: string;
  resource?: string;
  [key: string]: unknown;
}

export interface SecurityPostureIncident {
  id?: string;
  title?: string;
  severity?: string;
  status?: string;
  created_time?: string;
  [key: string]: unknown;
}

export interface SecurityPostureResult {
  subscription_id?: string;
  score?: number;
  summary?: string;
  top_findings?: SecurityPostureFinding[];
  severity_breakdown?: Record<string, number>;
  recommendations?: SecurityPostureRecommendation[];
  incidents?: SecurityPostureIncident[];
  error?: string;
}

export interface MulticloudComparisonResult {
  // compare_services() shape
  azure_service?: string;
  category?: string;
  matches?: Record<string, string | undefined>;
  why_azure?: string;
  note?: string;
  // decision_matrix() shape
  workload_type?: string;
  criteria?: string[];
  azure?: Record<string, number>;
  aws?: Record<string, number>;
  gcp?: Record<string, number>;
  notes?: string;
  error?: string;
}


export type StructuredResult =
  | { kind: "service_comparison"; data: ServiceComparison }
  | { kind: "compliance_result"; data: ComplianceResult }
  | { kind: "migration_assessment"; data: MigrationAssessment }
  | { kind: "dr_strategy"; data: DrStrategy }
  | { kind: "monitoring_config"; data: MonitoringConfig }
  | { kind: "cost_estimate"; data: CostEstimate }
  | { kind: "cost_alternatives"; data: CostAlternatives }
  | { kind: "clarification_request"; data: ClarificationRequest }
  | { kind: "learning_plan"; data: LearningPlan }
  | { kind: "network_topology"; data: NetworkTopology }
  | { kind: "landing_zone_design"; data: LandingZoneDesign }
  | { kind: "rbac_model"; data: RbacModel }
  | { kind: "threat_register"; data: ThreatRegister }
  | { kind: "pipeline_design"; data: PipelineDesign }
  | { kind: "slo_framework"; data: SloFramework }
  | { kind: "sku_recommendation"; data: SkuRecommendation }
  | { kind: "region_comparison"; data: RegionComparison }
  | { kind: "practice_exam_pack"; data: PracticeExamPack }
  | { kind: "stakeholder_plan"; data: StakeholderPlan }
  | { kind: "decision_card"; data: DecisionCard }
  | { kind: "terraform_files"; data: TerraformFilesResult }
  | { kind: "arm_files"; data: ArmFilesResult }
  | { kind: "cicd_files"; data: CicdFilesResult }
  | { kind: "cost_alerts"; data: CostAlertsResult }
  | { kind: "security_posture"; data: SecurityPostureResult }
  | { kind: "multicloud_comparison"; data: MulticloudComparisonResult }
  | { kind: "arb_submission_proposal"; data: ArbSubmissionProposal }
  | { kind: "arb_condition_action"; data: { action: "clear" | "waive"; payload: ArbConditionActionPayload } }
  | { kind: "arb_status_transition"; data: ArbStatusTransitionProposal };


// ── Presentation / deck builder types ────────────────────────────────────────

export interface SlideOutlineItem {
  slide_number: number;
  layout: "title" | "agenda" | "section_divider" | "content" | "two_column" | "quote_stat" | "summary" | "references";
  title: string;
  content: string[];
  right_content?: string[];
  speaker_notes: string;
}

export interface DeckOutline {
  deck_title: string;
  subtitle: string;
  slides: SlideOutlineItem[];
}

export interface DeckRecommendation {
  type: "structure" | "content" | "narrative" | "audience_fit";
  issue: string;
  suggestion: string;
  severity: "high" | "medium" | "low";
}

// ── Conversation history ─────────────────────────────────────────────────────

export interface ConversationRecord {
  id: string;
  mode: Mode;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  structuredResult?: unknown;
}

// ── Settings + multi-provider LLM ────────────────────────────────────────────

export interface ModelConfig {
  provider: "azure" | "github-models" | "github-copilot";
  model: string;
}

export interface UserSettings {
  mode_models: Partial<Record<Mode, ModelConfig>>;
}

export interface GithubTokenStatus {
  configured: boolean;
}

// ── Code generator types ──────────────────────────────────────────────────────

export interface CodeFile {
  name: string;
  content: string;
  language: string;
  description?: string;
}

// ── Project timeline / Gantt types ───────────────────────────────────────────

export interface TimelinePhase {
  id: string;
  name: string;
  start_week: number;
  duration_weeks: number;
  dependencies?: string[];
  is_milestone?: boolean;
  owner?: string;
}

export interface ProjectTimeline {
  phases: TimelinePhase[];
  total_weeks: number;
  critical_path?: string[];
  notes?: string;
  diagramXml: string;
}

// ── Troubleshooting types ─────────────────────────────────────────────────────

export interface DiagnosisHypothesis {
  hypothesis: string;
  likelihood: "high" | "medium" | "low";
  evidence_to_confirm: string;
  azure_service?: string;
}

export interface DiagnosisResult {
  root_cause_hypotheses: DiagnosisHypothesis[];
  affected_services: string[];
  severity: "critical" | "high" | "medium" | "low";
  estimated_blast_radius?: string;
}

export interface DiagnosticKqlQuery {
  name: string;
  query: string;
  purpose: string;
  table?: string;
}

export interface RemediationStep {
  step_number: number;
  action: string;
  command?: string;
  expected_output?: string;
  if_fails?: string;
}

export interface RemediationRunbook {
  steps: RemediationStep[];
  escalation_path?: string;
  estimated_resolution_minutes?: number;
}

// ── Bundled design (Full Design Pipeline) ────────────────────────────────────

export interface BicepResource {
  name: string;
  type: string;
  api_version: string;
  location: string | null;
}

export interface BicepDiagnostic {
  line: number;
  col: number;
  severity: "Error" | "Warning";
  code: string;
  message: string;
}

export interface BicepPreview {
  valid: boolean;
  errors: BicepDiagnostic[];
  resources: BicepResource[];
  total_count: number;
  arm_template: string | null;
}

export interface BundledDesign {
  workload_name: string;
  generated_at: string;
  architecture: { text: string; runbook?: string; bicep?: string; bicep_preview?: BicepPreview | null };
  sizing: { text: string };
  security: { text: string };
  waf: { pillars: WafPillarResult[] };
  quota_constraints?: QuotaConstraint[];
  cost_estimate?: { total_monthly_estimate?: number; line_items?: Array<Record<string, unknown>> } | null;
  confidence?: ConfidenceItem[];
}

export interface QuotaConstraintAlternative {
  region: string;
  available: number;
  subscription_id?: string;
}

export interface QuotaConstraint {
  service: string;
  sku: string;
  region: string;
  requested: number;
  available: number;
  subscription_id: string;
  alternatives: QuotaConstraintAlternative[];
}

export interface ConfidenceItem {
  dimension: string;
  score: number;
  rationale?: string;
  suggested_question?: string;
}

// ── Fabric capacity planner types ─────────────────────────────────────────────

export interface FabricSkuOption {
  sku: string;
  cu_capacity: number;
  monthly_cost_usd: number;
  utilization_estimate: number;
  status: "under" | "recommended" | "over";
  notes?: string;
}

export interface FabricCapacityPlan {
  recommended_sku: string;
  workload_summary: string;
  sizing_rationale: string;
  monthly_cost_usd: number;
  utilization_estimate: number;
  sku_options: FabricSkuOption[];
  risks: string[];
  pay_as_you_go_comparison: string;
}

// ── ADF pipeline generator types ─────────────────────────────────────────────

export interface AdfPipelineResult {
  pipeline_name: string;
  pattern: string;
  arm_template: string;
  notes: string[];
}

// ── Medallion schema designer types ──────────────────────────────────────────

export interface MedallionTable {
  name: string;
  ddl: string;
  delta_config?: string;
  unity_catalog_path?: string;
  notes?: string;
}

export interface MedallionLayer {
  layer: "Bronze" | "Silver" | "Gold";
  description: string;
  tables: MedallionTable[];
}

export interface MedallionSchemaDesign {
  source_system: string;
  layers: MedallionLayer[];
  governance_notes: string[];
}

// ── SSE event union ──────────────────────────────────────────────────────────

export type SseEvent =
  | { type: "token"; content: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "diagram"; xml: string }
  | { type: "runbook"; markdown: string }
  | { type: "bicep"; code: string; param_file?: string; deploy_commands?: string[]; notes?: string[] }
  | { type: "bicep_preview"; preview: BicepPreview }
  | { type: "cost_estimate"; estimate: CostEstimate }
  | { type: "cost_alternatives"; alternatives: CostAlternatives }
  | { type: "clarification_request"; request: ClarificationRequest }
  | { type: "priced_worksheet"; worksheet: PricedWorksheet }
  | { type: "region_availability"; availability: RegionAvailability }
  | { type: "monitoring_config"; config: MonitoringConfig }
  | { type: "compliance_result"; result: ComplianceResult }
  | { type: "migration_assessment"; assessment: MigrationAssessment }
  | { type: "dr_strategy"; strategy: DrStrategy }
  | { type: "service_comparison"; comparison: ServiceComparison }
  | { type: "waf_pillar"; pillar: WafPillarResult }
  | { type: "waf_complete"; pillars: WafPillarResult[] }
  | { type: "adr"; data: AdrRecord }
  | { type: "outline"; outline: DeckOutline }
  | { type: "review"; overall_assessment: string; recommendations: DeckRecommendation[]; improved_outline: DeckOutline }
  | { type: "file"; name: string; content: string; language: string; description?: string }
  | { type: "summary"; summary: string; repo_name: string }
  | { type: "learning_plan"; plan: LearningPlan }
  | { type: "network_topology"; topology: NetworkTopology }
  | { type: "landing_zone_design"; design: LandingZoneDesign }
  | { type: "rbac_model"; model: RbacModel }
  | { type: "threat_register"; register: ThreatRegister }
  | { type: "pipeline_design"; design: PipelineDesign }
  | { type: "slo_framework"; framework: SloFramework }
  | { type: "sku_recommendation"; recommendation: SkuRecommendation }
  | { type: "region_comparison"; comparison: RegionComparison }
  | { type: "practice_exam_pack"; pack: PracticeExamPack }
  | { type: "stakeholder_plan"; plan: StakeholderPlan }
  | { type: "decision_card"; card: DecisionCard }
  | { type: "project_timeline"; xml: string; phases: TimelinePhase[]; total_weeks: number; notes?: string }
  | { type: "diagnosis"; diagnosis: DiagnosisResult }
  | { type: "kql_queries"; queries: DiagnosticKqlQuery[] }
  | { type: "remediation_runbook"; steps: RemediationStep[]; escalation_path: string; estimated_minutes: number }
  | { type: "terraform_files"; files: Record<string, string>; pattern_name?: string; notes?: string[] }
  | { type: "arm_files"; files: Record<string, string>; pattern_name?: string; notes?: string[] }
  | { type: "cicd_files"; platform: string; files: Record<string, string>; pattern_name?: string; environment?: string; deploy_method?: string }
  | { type: "cost_alerts"; alerts: CostAlertsResult }
  | { type: "security_posture"; posture: SecurityPostureResult }
  | { type: "multicloud_comparison"; comparison: MulticloudComparisonResult }
  | { type: "strategy_result"; result: StrategyResult }
  | { type: "fabric_capacity_plan"; plan: FabricCapacityPlan }
  | { type: "adf_pipeline"; pipeline: AdfPipelineResult }
  | { type: "medallion_schema"; design: MedallionSchemaDesign }
  | { type: "bundled_design"; workload_name: string; generated_at: string; architecture: BundledDesign["architecture"]; sizing: BundledDesign["sizing"]; security: BundledDesign["security"]; waf: BundledDesign["waf"]; quota_constraints?: QuotaConstraint[]; cost_estimate?: BundledDesign["cost_estimate"] }
  | { type: "arb_submission_proposal"; proposal: ArbSubmissionProposal }
  | { type: "arb_condition_action"; action: "clear" | "waive"; payload: ArbConditionActionPayload }
  | { type: "arb_status_transition"; transition: ArbStatusTransitionProposal }
  | { type: "done" }
  | { type: "agent_route"; agent: string; domain_fragments?: string[]; recommended_tool?: string; reason?: string; engagement_scoped?: boolean }
  | { type: "status"; message: string }
  | { type: "error"; message: string };

// ── Cross-panel handoff seed ─────────────────────────────────────────────────

/** Prefilled inputs handed to the Demo Builder when a Demo Showcase entry is
 * used as a starting point. All fields are best-effort — the builder treats
 * them as editable defaults the user refines before running. */
export interface DemoBuilderSeed {
  demo_slug: string;
  demo_title: string;
  description: string;
  key_features: string[];
  azure_services: string[];
}

/** Payload passed to `handleContinueIn(mode, seed)`. Strings are treated as a
 * user-message text seed (legacy behavior); objects carry richer context such
 * as a validated WorkloadSpec and an auto-start flag for pipeline panels, or a
 * Demo Builder seed when launching the demo-build pipeline. */
export type ContinueInSeed =
  | string
  | { spec?: WorkloadSpec; autoStart?: boolean; demoSeed?: DemoBuilderSeed };

// ── Cost optimization pipeline ───────────────────────────────────────────────

// ── Cost Optimize (meter-aware live pricing) ─────────────────────────────────

export interface CostCatalogDimension {
  key: string;
  label: string;
  unit: string;
  quantity_field: string;
  default_quantity: number;
  included_free: number;
  required: boolean;
  instance_scaled: boolean;
}

export interface CostCatalogService {
  service: string;
  label: string;
  aliases: string[];
  category: string;
  sku_field: string;
  ri_eligible: boolean;
  dimensions: CostCatalogDimension[];
}

export interface CostCatalog {
  version: number;
  currency_default: string;
  region_default: string;
  services: CostCatalogService[];
}

export interface CostMeter {
  dimension: string;
  label: string;
  unit: string | null;
  quantity?: number;
  included_free?: number;
  billable_quantity?: number;
  unit_price: number | null;
  unit_of_measure?: string | null;
  monthly_cost: number | null;
  meter_id?: string | null;
  meter_name?: string | null;
  priced: boolean;
  note?: string;
  source?: string;
}

export interface CostBreakdownLine {
  service: string;
  display_name: string;
  category?: string;
  sku: string;
  region: string;
  catalog_matched: boolean;
  ri_eligible?: boolean;
  tags?: string[];
  meters: CostMeter[];
  monthly_subtotal: number;
  currency: string;
}

export interface CostBreakdown {
  line_items: CostBreakdownLine[];
  total_monthly_estimate: number;
  currency: string;
  summary?: { total_lines: number; catalog_matched: number; unpriced_meters: number };
  data_source?: string;
  disclaimer?: string;
}

export interface CostRecommendation {
  id: string;
  line_ref: number | null;
  service?: string | null;
  type: "reserved_instance" | "storage_tier" | "idle_resource" | "region_shift" | string;
  title: string;
  rationale: string;
  current_monthly: number | null;
  proposed_monthly: number | null;
  monthly_savings: number;
  confidence: string;
  effort: string;
  break_even?: Record<string, unknown>;
  carbon_kgco2e_per_month?: number;
}

export interface CostRecommendations {
  recommendations: CostRecommendation[];
  total_monthly_savings: number;
  total_annual_savings: number;
  count: number;
}

export interface CostTemplateParseResult {
  model_name?: string;
  region?: string;
  currency?: string;
  items: CostTemplateLineItem[];
  warnings: string[];
  error: string | null;
}

export interface CostTemplateLineItem {
  service: string;
  display_name?: string;
  sku?: string;
  region?: string;
  quantity?: number;
  hours_per_month?: number;
  dimensions?: Record<string, number>;
  tags?: string[];
  commitment?: string;
}

export interface CostOptimization {
  type: "cost_optimization";
  generated_at: string;
  engagement_id: string | null;
  estimate: Record<string, unknown> | null;
  cost_breakdown: CostBreakdown | null;
  live_price: Record<string, unknown> | null;
  carbon: Record<string, unknown> | null;
  reservations: Record<string, unknown> | null;
  rightsizing: Record<string, unknown> | null;
  break_even: Record<string, unknown> | null;
  recommendations: CostRecommendations | null;
  report: string;
}

// ── Demo Builder ─────────────────────────────────────────────────────────────

export interface DemoFileManifestEntry {
  path: string;
  kind: "code" | "infra" | "docs" | "config";
  size: number;
  sha256: string;
}

export interface DemoSpec {
  slug: string;
  title: string;
  audience: "customer" | "internal" | "partner";
  duration_minutes: number;
  target_persona: string;
  key_features: string[];
  azure_services: string[];
  workload_spec: Record<string, unknown>;
}

export type DemoVerifyResult =
  | { ok: boolean; output: string }
  | { skipped: true; reason: string };

export interface DemoBuilt {
  type: "demo_built";
  generated_at: string;
  engagement_id: string | null;
  job_id: string;
  spec: DemoSpec | null;
  azure_services: string[];
  demo_archetype: string;
  behind_the_scenes: Array<{ service: string; role: string }>;
  live_activity: DemoLiveActivityStep[];
  talk_track: string;
  manifest: DemoFileManifestEntry[];
  diagrams: Array<{ name: string; mermaid: string }>;
  verify: DemoVerifyResult | null;
  repo_url: string | null;
  readme_md: string;
}

/** One ordered step in the live Azure request flow, authored by the design
 *  phase. Drives the in-app Azure Activity Panel and the mocked preview. */
export interface DemoLiveActivityStep {
  step_id: string;
  service: string;
  stage: string;
  detail?: string;
  duration_ms?: number;
}
