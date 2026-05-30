import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Spinner,
  TabList,
  Tab,
  Select,
  Badge,
} from "@fluentui/react-components";
import { SendRegular, ChatRegular } from "@fluentui/react-icons";
import { useSSE } from "../hooks/useSSE";
import type { ChatMessage, LandingZoneDesign, ManagementGroup } from "../types";

type LzTab = "overview" | "management-groups" | "networking" | "identity" | "policy";

const COMPLIANCE_OPTIONS = ["None", "HIPAA", "PCI-DSS", "ISO 27001", "SOC 2", "FedRAMP", "GDPR", "NIST 800-53"];
const NETWORK_OPTIONS = [
  { value: "hub-spoke", label: "Hub-Spoke (Azure Firewall hub)" },
  { value: "vwan", label: "Virtual WAN (managed hub)" },
  { value: "flat", label: "Flat (no hub, simpler)" },
  { value: "multi-hub", label: "Multi-Hub (regional hubs)" },
];

const useStyles = makeStyles({
  panel: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
  layout: { display: "flex", flex: 1, overflow: "hidden" },
  sidebar: {
    width: "340px",
    minWidth: "280px",
    flexShrink: 0,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    padding: "20px 16px",
    gap: "14px",
    overflowY: "auto",
  },
  right: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  tabBar: {
    padding: "0 16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  tabContent: { flex: 1, overflowY: "auto", padding: "20px" },
  label: {
    fontWeight: 600,
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    marginBottom: "4px",
    display: "block",
  },
  reqBox: {
    width: "100%",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "8px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: "100px",
    lineHeight: "1.5",
    "&::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  textInput: {
    width: "100%",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "6px",
    padding: "6px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    "&::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  divider: { height: "1px", background: tokens.colorNeutralStroke2, margin: "2px 0" },
  statusText: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  mdContent: {
    fontSize: "13px",
    lineHeight: 1.6,
    "& h1, & h2, & h3": { marginTop: "12px", marginBottom: "6px", fontWeight: 700 },
    "& p": { marginBottom: "8px" },
    "& ul, & ol": { paddingLeft: "20px", marginBottom: "8px" },
    "& code": { background: tokens.colorNeutralBackground3, borderRadius: "3px", padding: "1px 4px" },
    "& table": { borderCollapse: "collapse", width: "100%" },
    "& th, & td": { border: `1px solid ${tokens.colorNeutralStroke2}`, padding: "6px 10px" },
  },
  emptyTab: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "120px",
    color: tokens.colorNeutralForeground3,
  },
  tabDot: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: tokens.colorBrandBackground,
    marginLeft: "5px",
    verticalAlign: "middle",
  },
  mgRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "7px 0",
    fontSize: "13px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  rbacGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "8px",
    fontSize: "13px",
    padding: "7px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    alignItems: "center",
  },
  tagRow: {
    display: "flex",
    gap: "12px",
    fontSize: "13px",
    padding: "5px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
});

function MgNode({ mg, depth = 0 }: { mg: ManagementGroup; depth?: number }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: `6px 0 6px ${depth * 20}px`, fontSize: "13px", borderBottom: "1px solid rgba(128,128,128,0.1)" }}>
        <span style={{ color: depth === 0 ? "#0078D4" : tokens.colorNeutralForeground2, fontWeight: depth <= 1 ? 600 : 400 }}>
          {depth === 0 ? "⬡" : "◆"} {mg.name}
        </span>
        <Badge appearance="tint" color="informative" size="small">Level {mg.level}</Badge>
      </div>
      {mg.children?.map((child) => (
        <MgNode key={`${child.name}-${child.level}`} mg={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function LandingZonePanel({ onRefine }: { onRefine?: (context: ChatMessage[]) => void }) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();

  const [orgDescription, setOrgDescription] = useState("");
  const [numSubscriptions, setNumSubscriptions] = useState("");
  const [compliance, setCompliance] = useState("None");
  const [networkTopology, setNetworkTopology] = useState("hub-spoke");

  const [activeTab, setActiveTab] = useState<LzTab>("overview");
  const [narrative, setNarrative] = useState("");
  const [design, setDesign] = useState<LandingZoneDesign | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  async function handleRun() {
    if (!orgDescription.trim() || isStreaming) return;
    setNarrative("");
    setDesign(null);
    setStatusMsg("");
    setActiveTab("overview");

    const prompt = [
      `Organization: ${orgDescription}`,
      numSubscriptions ? `Expected subscription count: ${numSubscriptions}` : "",
      compliance !== "None" ? `Compliance requirements: ${compliance}` : "",
      `Preferred network topology: ${NETWORK_OPTIONS.find((n) => n.value === networkTopology)?.label}`,
    ].filter(Boolean).join("\n");

    await stream("/api/chat", { mode: "landingzone", message: prompt }, (event) => {
      if (event.type === "token") setNarrative((p) => p + event.content);
      if (event.type === "landing_zone_design") setDesign(event.design);
      if (event.type === "status") setStatusMsg(event.message);
    });
    setStatusMsg("");
  }

  function handleRefine() {
    if (!onRefine || !narrative) return;
    onRefine([{
      id: crypto.randomUUID(),
      role: "assistant",
      content: `## Azure Landing Zone Design\n\n${narrative}`,
    }]);
  }

  const hasMgData = (design?.management_groups?.length ?? 0) > 0;
  const hasRbacData = (design?.rbac_assignments?.length ?? 0) > 0;
  const hasPolicyData = (design?.policy_initiatives?.length ?? 0) > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <Text weight="semibold" size={400}>Landing Zone Design</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: "-8px" }}>
            Azure Cloud Adoption Framework
          </Text>
          <div className={styles.divider} />

          <div>
            <label className={styles.label}>Organization Description *</label>
            <textarea
              className={styles.reqBox}
              value={orgDescription}
              onChange={(e) => setOrgDescription(e.target.value)}
              placeholder="e.g. Mid-size healthcare org, 3 business units, 500 developers, migrating from on-prem over 18 months..."
              disabled={isStreaming}
            />
          </div>

          <div>
            <label className={styles.label}>Estimated Subscription Count</label>
            <input
              type="text"
              className={styles.textInput}
              value={numSubscriptions}
              onChange={(e) => setNumSubscriptions(e.target.value)}
              placeholder="e.g. 10–50"
              disabled={isStreaming}
            />
          </div>

          <div>
            <label className={styles.label}>Compliance Framework</label>
            <Select value={compliance} onChange={(_, d) => setCompliance(d.value)} disabled={isStreaming}>
              {COMPLIANCE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>

          <div>
            <label className={styles.label}>Network Topology</label>
            <Select value={networkTopology} onChange={(_, d) => setNetworkTopology(d.value)} disabled={isStreaming}>
              {NETWORK_OPTIONS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
            </Select>
          </div>

          <div className={styles.divider} />

          {isStreaming ? (
            <Button appearance="primary" icon={<Spinner size="tiny" />} onClick={cancel}>Stop</Button>
          ) : (
            <Button appearance="primary" icon={<SendRegular />} onClick={handleRun} disabled={!orgDescription.trim()}>
              Design Landing Zone
            </Button>
          )}

          {statusMsg && <Text className={styles.statusText}>{statusMsg}</Text>}

          {narrative && !isStreaming && onRefine && (
            <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine}>
              Refine in Chat
            </Button>
          )}
        </div>

        <div className={styles.right}>
          <div className={styles.tabBar}>
            <TabList
              selectedValue={activeTab}
              onTabSelect={(_, d) => setActiveTab(d.value as LzTab)}
              size="small"
            >
              <Tab value="overview">Overview{narrative && <span className={styles.tabDot} />}</Tab>
              <Tab value="management-groups">Mgmt Groups{hasMgData && <span className={styles.tabDot} />}</Tab>
              <Tab value="networking">Networking{design && <span className={styles.tabDot} />}</Tab>
              <Tab value="identity">Identity & Access{hasRbacData && <span className={styles.tabDot} />}</Tab>
              <Tab value="policy">Policy & Governance{hasPolicyData && <span className={styles.tabDot} />}</Tab>
            </TabList>
          </div>

          <div className={styles.tabContent}>
            {activeTab === "overview" && (
              narrative ? (
                <div className={styles.mdContent}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Designing landing zone…" : "Describe your organization and click Design Landing Zone."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "management-groups" && (
              hasMgData ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>Management Group Hierarchy</Text>
                  {design!.management_groups.map((mg) => (
                    <MgNode key={mg.name} mg={mg} depth={0} />
                  ))}
                  {design!.naming_convention && (
                    <div style={{ marginTop: "20px" }}>
                      <Text weight="semibold" size={300} block style={{ marginBottom: "6px" }}>Naming Convention</Text>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{design!.naming_convention}</Text>
                    </div>
                  )}
                  {Object.keys(design!.mandatory_tags ?? {}).length > 0 && (
                    <div style={{ marginTop: "20px" }}>
                      <Text weight="semibold" size={300} block style={{ marginBottom: "8px" }}>Mandatory Tags</Text>
                      {Object.entries(design!.mandatory_tags).map(([k, v]) => (
                        <div key={k} className={styles.tagRow}>
                          <Text weight="semibold" style={{ minWidth: "160px", fontSize: "13px" }}>{k}</Text>
                          <Text style={{ color: tokens.colorNeutralForeground2, fontSize: "13px" }}>{v}</Text>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Building management group hierarchy…" : "Run Design Landing Zone to see the management structure."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "networking" && (
              design ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>Network Architecture</Text>
                  <div style={{ marginBottom: "12px" }}>
                    <Badge appearance="filled" color="brand">
                      {NETWORK_OPTIONS.find((n) => n.value === networkTopology)?.label}
                    </Badge>
                  </div>
                  {design.subscription_vending && (
                    <div className={styles.mdContent}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{design.subscription_vending}</ReactMarkdown>
                    </div>
                  )}
                  {!design.subscription_vending && (
                    <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
                      See the Overview tab for detailed networking guidance.
                    </Text>
                  )}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Designing network topology…" : "Run Design Landing Zone to see networking guidance."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "identity" && (
              hasRbacData ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>RBAC Assignments</Text>
                  <div className={styles.rbacGrid} style={{ fontWeight: 600, fontSize: "12px", color: tokens.colorNeutralForeground2, borderBottom: `2px solid ${tokens.colorNeutralStroke2}` }}>
                    <span>Principal / Group</span>
                    <span>Role</span>
                    <span>Scope</span>
                  </div>
                  {design!.rbac_assignments.map((a, i) => (
                    <div key={i} className={styles.rbacGrid}>
                      <Text size={200}>{a.principal}</Text>
                      <Badge appearance="tint" color="informative" size="small">{a.role}</Badge>
                      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{a.scope}</Text>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Designing identity model…" : "Run Design Landing Zone to see RBAC assignments."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "policy" && (
              hasPolicyData ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>Policy Initiatives</Text>
                  {design!.policy_initiatives.map((p, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 0", borderBottom: "1px solid rgba(128,128,128,0.1)", fontSize: "13px" }}>
                      <Badge appearance="filled" color="brand" size="small" style={{ marginTop: "2px", flexShrink: 0 }}>{i + 1}</Badge>
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Defining Azure Policy framework…" : "Run Design Landing Zone to see policy initiatives."}
                  </Text>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
