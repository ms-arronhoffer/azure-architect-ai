import { useState, useEffect } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
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
import type { ChatMessage, Threat, ThreatRegister, ConversationRecord, Mode } from "../types";

type TmTab = "overview" | "stride" | "attack-surface" | "mitigations" | "controls";

const DATA_CLASSIFICATIONS = ["Public", "Internal", "Confidential", "Restricted / PII", "Highly Restricted / PHI"];

const RISK_COLOR = (score: number): "danger" | "warning" | "informative" | "success" => {
  if (score >= 16) return "danger";
  if (score >= 9) return "warning";
  if (score >= 4) return "informative";
  return "success";
};

const STRIDE_CATEGORIES = ["Spoofing", "Tampering", "Repudiation", "Information Disclosure", "Denial of Service", "Elevation of Privilege"];

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
  threatCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "12px",
    marginBottom: "10px",
    background: tokens.colorNeutralBackground1,
  },
  threatHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
  },
  threatMeta: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    marginBottom: "8px",
  },
  threatSection: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
    marginTop: "6px",
  },
  strideGroup: {
    marginBottom: "20px",
  },
  strideHeader: {
    fontWeight: 700,
    fontSize: "14px",
    marginBottom: "8px",
    paddingBottom: "4px",
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  surfaceItem: {
    padding: "7px 0",
    fontSize: "13px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
  },
  controlItem: {
    padding: "8px 0",
    fontSize: "13px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
  },
});

function ThreatCard({ threat, styles }: { threat: Threat; styles: ReturnType<typeof useStyles> }) {
  return (
    <div className={styles.threatCard}>
      <div className={styles.threatHeader}>
        <Badge appearance="filled" color={RISK_COLOR(threat.risk_score)} size="small">
          Risk {threat.risk_score}
        </Badge>
        <Text weight="semibold" size={300}>{threat.title}</Text>
        <Badge appearance="tint" color={threat.status === "Mitigated" ? "success" : threat.status === "Accepted" ? "warning" : "danger"} size="small">
          {threat.status}
        </Badge>
      </div>
      <div className={styles.threatMeta}>
        <Badge appearance="outline" color="informative" size="small">L:{threat.likelihood}</Badge>
        <Badge appearance="outline" color="informative" size="small">I:{threat.impact}</Badge>
        <Badge appearance="tint" color="subtle" size="small">{threat.stride_category}</Badge>
      </div>
      {threat.mitigations.length > 0 && (
        <div className={styles.threatSection}>
          <strong>Mitigations:</strong>
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {threat.mitigations.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}
      {threat.azure_controls.length > 0 && (
        <div className={styles.threatSection}>
          <strong>Azure Controls:</strong>{" "}
          {threat.azure_controls.join(", ")}
        </div>
      )}
    </div>
  );
}

export default function ThreatModelPanel({ onRefine, sessionId, onSave, initialSession }: {
  onRefine?: (context: ChatMessage[]) => void;
  sessionId?: string;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[], structuredResult: unknown) => void;
  initialSession?: ConversationRecord;
}) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();

  const [archDescription, setArchDescription] = useState("");
  const [dataClassification, setDataClassification] = useState("Confidential");
  const [integrations, setIntegrations] = useState("");

  const [activeTab, setActiveTab] = useState<TmTab>("overview");
  const [narrative, setNarrative] = useState("");
  const [register, setRegister] = useState<ThreatRegister | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (!initialSession?.structuredResult) return;
    const sr = initialSession.structuredResult as { narrative?: string; register?: ThreatRegister };
    if (sr.narrative) setNarrative(sr.narrative);
    if (sr.register) setRegister(sr.register);
  }, []);

  async function handleRun() {
    if (!archDescription.trim() || isStreaming) return;
    setNarrative("");
    setRegister(null);
    setStatusMsg("");
    setActiveTab("overview");

    const prompt = [
      `Architecture Description: ${archDescription}`,
      `Data Classification: ${dataClassification}`,
      integrations ? `External Integrations: ${integrations}` : "",
    ].filter(Boolean).join("\n");

    let localNarrative = "";
    let localRegister: ThreatRegister | null = null;

    await stream("/api/chat", { mode: "threatmodel", message: prompt }, (event) => {
      if (event.type === "token") { localNarrative += event.content; setNarrative((p) => p + event.content); }
      if (event.type === "threat_register") { localRegister = event.register; setRegister(event.register); }
      if (event.type === "status") setStatusMsg(event.message);
    });
    setStatusMsg("");

    if (onSave && sessionId && (localNarrative || localRegister)) {
      const msgs: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "user", content: prompt },
        { id: crypto.randomUUID(), role: "assistant", content: localNarrative },
      ];
      onSave(sessionId, "threatmodel", msgs, { narrative: localNarrative, register: localRegister });
    }
  }

  function handleRefine() {
    if (!onRefine || !narrative) return;
    const parts: string[] = [`## Threat Model Overview\n\n${narrative}`];
    if (register?.threats.length) {
      const topThreats = [...register.threats]
        .sort((a, b) => b.risk_score - a.risk_score)
        .slice(0, 5)
        .map((t) => `- **${t.title}** (Risk: ${t.risk_score}, ${t.stride_category}): ${t.mitigations[0] ?? ""}`)
        .join("\n");
      parts.push(`## Top Threats\n\n${topThreats}`);
    }
    onRefine([{ id: crypto.randomUUID(), role: "assistant", content: parts.join("\n\n") }]);
  }

  const hasRegister = (register?.threats?.length ?? 0) > 0;
  const hasAttackSurface = (register?.attack_surface?.length ?? 0) + (register?.trust_boundaries?.length ?? 0) > 0;
  const hasControls = (register?.security_controls_recommended?.length ?? 0) > 0;

  const threatsByStride = register?.threats
    ? STRIDE_CATEGORIES.reduce<Record<string, Threat[]>>((acc, cat) => {
        const threats = register.threats.filter((t) => t.stride_category === cat);
        if (threats.length > 0) acc[cat] = threats;
        return acc;
      }, {})
    : {};

  const mitigationsSorted = register?.threats
    ? [...register.threats].sort((a, b) => b.risk_score - a.risk_score)
    : [];

  return (
    <div className={styles.panel}>
      <PanelGroup orientation="horizontal" style={{ height: "100%", overflow: "hidden" }}>
        <Panel defaultSize={32} minSize={15} maxSize={65}>
          <div style={{ height: "100%", overflowY: "auto", padding: "20px 16px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, background: tokens.colorNeutralBackground1, display: "flex", flexDirection: "column", gap: "14px" }}>
          <Text weight="semibold" size={400}>Threat Model</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: "-8px" }}>
            STRIDE Analysis & Security Controls
          </Text>
          <div className={styles.divider} />

          <div>
            <label className={styles.label}>Architecture Description *</label>
            <textarea
              className={styles.reqBox}
              value={archDescription}
              onChange={(e) => setArchDescription(e.target.value)}
              placeholder="e.g. Multi-tier web app with React frontend, Node.js API, PostgreSQL DB, Azure Blob Storage, and Entra ID auth..."
              disabled={isStreaming}
            />
          </div>

          <div>
            <label className={styles.label}>Data Classification</label>
            <Select value={dataClassification} onChange={(_, d) => setDataClassification(d.value)} disabled={isStreaming}>
              {DATA_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>

          <div>
            <label className={styles.label}>External Integrations (optional)</label>
            <input
              type="text"
              className={styles.textInput}
              value={integrations}
              onChange={(e) => setIntegrations(e.target.value)}
              placeholder="e.g. Stripe API, Salesforce, on-prem LDAP"
              disabled={isStreaming}
            />
          </div>

          <div className={styles.divider} />

          {isStreaming ? (
            <Button appearance="primary" icon={<Spinner size="tiny" />} onClick={cancel}>Stop</Button>
          ) : (
            <Button appearance="primary" icon={<SendRegular />} onClick={handleRun} disabled={!archDescription.trim()}>
              Analyze Threats
            </Button>
          )}

          {statusMsg && <Text className={styles.statusText}>{statusMsg}</Text>}

          {narrative && !isStreaming && onRefine && (
            <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine}>
              Refine in Chat
            </Button>
          )}
          </div>
        </Panel>

        <PanelResizeHandle style={{ width: "4px", background: tokens.colorNeutralBackground3, cursor: "col-resize" }} />

        <Panel>
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className={styles.tabBar}>
            <TabList
              selectedValue={activeTab}
              onTabSelect={(_, d) => setActiveTab(d.value as TmTab)}
              size="small"
            >
              <Tab value="overview">Overview{narrative && <span className={styles.tabDot} />}</Tab>
              <Tab value="stride">STRIDE Analysis{hasRegister && <span className={styles.tabDot} />}</Tab>
              <Tab value="attack-surface">Attack Surface{hasAttackSurface && <span className={styles.tabDot} />}</Tab>
              <Tab value="mitigations">Mitigations{hasRegister && <span className={styles.tabDot} />}</Tab>
              <Tab value="controls">Security Controls{hasControls && <span className={styles.tabDot} />}</Tab>
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
                    {isStreaming ? "Analyzing threat model…" : "Describe your architecture and click Analyze Threats."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "stride" && (
              hasRegister ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>
                    Threats by STRIDE Category
                  </Text>
                  {Object.entries(threatsByStride).map(([cat, threats]) => (
                    <div key={cat} className={styles.strideGroup}>
                      <div className={styles.strideHeader}>
                        {cat}
                        <Badge appearance="tint" color="informative" size="small" style={{ marginLeft: "8px" }}>
                          {threats.length}
                        </Badge>
                      </div>
                      {threats.map((t) => <ThreatCard key={t.id} threat={t} styles={styles} />)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Building STRIDE analysis…" : "Run Analyze Threats to see STRIDE breakdown."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "attack-surface" && (
              hasAttackSurface ? (
                <div>
                  {(register?.trust_boundaries?.length ?? 0) > 0 && (
                    <>
                      <Text weight="semibold" size={300} block style={{ marginBottom: "10px" }}>Trust Boundaries</Text>
                      {register!.trust_boundaries.map((b, i) => (
                        <div key={i} className={styles.surfaceItem}>
                          <Badge appearance="filled" color="warning" size="small" style={{ marginTop: "1px", flexShrink: 0 }}>{i + 1}</Badge>
                          <Text size={200}>{b}</Text>
                        </div>
                      ))}
                    </>
                  )}
                  {(register?.attack_surface?.length ?? 0) > 0 && (
                    <div style={{ marginTop: "20px" }}>
                      <Text weight="semibold" size={300} block style={{ marginBottom: "10px" }}>Attack Surface</Text>
                      {register!.attack_surface.map((s, i) => (
                        <div key={i} className={styles.surfaceItem}>
                          <Badge appearance="filled" color="danger" size="small" style={{ marginTop: "1px", flexShrink: 0 }}>{i + 1}</Badge>
                          <Text size={200}>{s}</Text>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Enumerating attack surface…" : "Run Analyze Threats to see attack surface."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "mitigations" && (
              hasRegister ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>
                    Threats by Risk Score (Highest First)
                  </Text>
                  {mitigationsSorted.map((t) => <ThreatCard key={t.id} threat={t} styles={styles} />)}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Generating mitigations…" : "Run Analyze Threats to see mitigations."}
                  </Text>
                </div>
              )
            )}

            {activeTab === "controls" && (
              hasControls ? (
                <div>
                  <Text weight="semibold" size={300} block style={{ marginBottom: "12px" }}>
                    Recommended Security Controls
                  </Text>
                  {register!.security_controls_recommended.map((c, i) => (
                    <div key={i} className={styles.controlItem}>
                      <Badge appearance="filled" color="brand" size="small" style={{ marginTop: "2px", flexShrink: 0 }}>{i + 1}</Badge>
                      <Text size={200}>{c}</Text>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyTab}>
                  <Text size={300}>
                    {isStreaming ? "Recommending security controls…" : "Run Analyze Threats to see security controls."}
                  </Text>
                </div>
              )
            )}
          </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
