import { useEffect, useRef, useState } from "react";
import { FluentProvider, makeStyles, tokens } from "@fluentui/react-components";
import { azureDarkTheme, azureLightTheme } from "./theme";
import SideNav from "./components/SideNav";
import Header from "./components/Header";
import HistoryDrawer from "./components/HistoryDrawer";
import AdvisorPanel, { ADVISOR_MODES } from "./components/AdvisorPanel";
import ArchitecturePanel from "./components/ArchitecturePanel";
import WAFPanel from "./components/WAFPanel";
import ReviewPanel from "./components/ReviewPanel";
import DRBCPanel from "./components/DRBCPanel";
import ReferenceLibrary from "./components/ReferenceLibrary";
import StrategyPanel from "./components/StrategyPanel";
import PresentationPanel from "./components/PresentationPanel";
import SettingsDrawer from "./components/SettingsDrawer";
import CodegenPanel from "./components/CodegenPanel";
import LearningPlanPanel from "./components/LearningPlanPanel";
import TCOPanel from "./components/TCOPanel";
import BootstrapPanel from "./components/BootstrapPanel";
import SizingPanel from "./components/SizingPanel";
import WorkloadContextPanel from "./components/WorkloadContextPanel";
import IntakePanel from "./components/IntakePanel";
import AnalysisPanel from "./components/AnalysisPanel";
import LandingZonePanel from "./components/LandingZonePanel";
import ThreatModelPanel from "./components/ThreatModelPanel";
import ReliabilityPanel from "./components/ReliabilityPanel";
import TroubleshootingPanel from "./components/TroubleshootingPanel";
import WhatsNewPanel from "./components/WhatsNewPanel";
import ServiceHealthPanel from "./components/ServiceHealthPanel";
import MetricsDashboard from "./components/MetricsDashboard";
import TelemetryDebugDrawer from "./components/TelemetryDebugDrawer";
import { useConversationHistory } from "./hooks/useConversationHistory";
import { useWorkloadContext } from "./hooks/useWorkloadContext";
import { useSettings } from "./hooks/useSettings";
import { useServiceHealth } from "./hooks/useServiceHealth";
import { track } from "./utils/telemetry";
import type { Mode, ConversationRecord, ChatMessage } from "./types";

const useStyles = makeStyles({
  root: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    background: tokens.colorNeutralBackground2,
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  },
  content: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
});

const ARCH_MODES: Mode[] = ["architecture", "network", "aiarchitecture", "dataplatform", "apim"];
const PANEL_MODES: Mode[] = [...ARCH_MODES, "waf", "review", "drbc", "sizing", "tco", "threatmodel", "reliability", "landingzone", "troubleshoot", "strategy"];

export default function App() {
  const styles = useStyles();
  const [darkMode, setDarkMode] = useState(true);
  const [mode, setMode] = useState<Mode>("qa");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<ConversationRecord | null>(null);
  const [refinementSeed, setRefinementSeed] = useState<{ id: string; messages: ChatMessage[]; suggestedReplies?: string[] } | null>(null);
  const [selectedPanelSession, setSelectedPanelSession] = useState<ConversationRecord | null>(null);
  const { conversations, upsert, remove, clear, fork } = useConversationHistory();
  const { context: workloadContext, setContext: setWorkloadContext, clearContext } = useWorkloadContext();
  const { settings, saveSettings, githubTokenConfigured, setGithubToken, clearGithubToken } = useSettings();
  const { incidents: healthIncidents, incidentCount, loading: healthLoading, error: healthError, lastChecked: healthLastChecked, refresh: refreshHealth } = useServiceHealth();

  const wafSessionId = useRef(crypto.randomUUID()).current;
  const reviewSessionId = useRef(crypto.randomUUID()).current;
  const drbcSessionId = useRef(crypto.randomUUID()).current;
  const sizingSessionId = useRef(crypto.randomUUID()).current;
  const tcoSessionId = useRef(crypto.randomUUID()).current;
  const threatModelSessionId = useRef(crypto.randomUUID()).current;
  const reliabilitySessionId = useRef(crypto.randomUUID()).current;
  const landingZoneSessionId = useRef(crypto.randomUUID()).current;
  const troubleshootSessionId = useRef(crypto.randomUUID()).current;
  const strategySessionId = useRef(crypto.randomUUID()).current;

  function handleModeChange(m: Mode) {
    setMode(m);
    setSelectedConversation(null);
    setSelectedPanelSession(null);
    setRefinementSeed(null);
    track({ kind: "mode_open", mode: m });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault();
        setTelemetryOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleLoadConversation(conv: ConversationRecord) {
    setMode(conv.mode);
    setRefinementSeed(null);
    setHistoryOpen(false);
    if (PANEL_MODES.includes(conv.mode)) {
      setSelectedPanelSession(conv);
      setSelectedConversation(null);
    } else {
      setSelectedConversation(conv);
      setSelectedPanelSession(null);
    }
  }

  function handleRefine(context: ChatMessage[], suggestedReplies?: string[]) {
    setRefinementSeed({ id: crypto.randomUUID(), messages: context, suggestedReplies });
    setMode("qa");
    setSelectedConversation(null);
    setSelectedPanelSession(null);
  }

  function handlePanelSave(id: string, m: Mode, messages: ChatMessage[], structuredResult: unknown) {
    upsert(id, m, messages, structuredResult);
  }

  function panelSession(m: Mode): ConversationRecord | undefined {
    return selectedPanelSession?.mode === m ? selectedPanelSession : undefined;
  }

  async function handleFork(messages: ChatMessage[], upToIndex: number) {
    const sliced = messages.slice(0, upToIndex + 1);
    const newConv = await fork(crypto.randomUUID(), mode, sliced);
    if (newConv) {
      setSelectedConversation(newConv);
    }
  }

  function handleContinueIn(targetMode: Mode, seed: string) {
    const seedMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: seed };
    setRefinementSeed({ id: crypto.randomUUID(), messages: [seedMsg] });
    setMode(targetMode);
    setSelectedConversation(null);
  }

  const chatKey = selectedConversation
    ? `${mode}-${selectedConversation.id}`
    : refinementSeed
      ? `qa-refine-${refinementSeed.id}`
      : mode;

  const initialMessages = selectedConversation?.messages ?? refinementSeed?.messages;

  function renderMode() {
    if (mode === "intake") {
      return <IntakePanel key="intake" onContinueIn={handleContinueIn} />;
    }
    if (mode === "analyze") {
      return <AnalysisPanel key="analyze" onRefine={handleRefine} onContinueIn={handleContinueIn} />;
    }
    if (ARCH_MODES.includes(mode)) {
      return (
        <ArchitecturePanel
          key={selectedPanelSession?.id ?? "arch"}
          mode={mode}
          onRefine={handleRefine}
          onModeChange={handleModeChange}
          workloadContext={workloadContext}
          onSave={(id, m, msgs, sr) => handlePanelSave(id, m, msgs, sr)}
          initialSession={ARCH_MODES.includes(selectedPanelSession?.mode ?? "" as Mode) ? selectedPanelSession ?? undefined : undefined}
        />
      );
    }
    if (mode === "waf") {
      return (
        <WAFPanel
          key="waf"
          onRefine={handleRefine}
          conversationId={wafSessionId}
          onSave={(id, m, msgs, sr) => handlePanelSave(id, m, msgs, sr)}
          initialSession={panelSession("waf")}
        />
      );
    }
    if (mode === "review") {
      return (
        <ReviewPanel
          key="review"
          onRefine={handleRefine}
          conversationId={reviewSessionId}
          onSave={(id, m, msgs, sr) => handlePanelSave(id, m, msgs, sr)}
          initialSession={panelSession("review")}
        />
      );
    }
    if (mode === "drbc") return <DRBCPanel key="drbc" onRefine={handleRefine} sessionId={drbcSessionId} onSave={handlePanelSave} initialSession={panelSession("drbc")} />;
    if (mode === "landingzone") return <LandingZonePanel key="landingzone" onRefine={handleRefine} sessionId={landingZoneSessionId} onSave={handlePanelSave} initialSession={panelSession("landingzone")} />;
    if (mode === "threatmodel") return <ThreatModelPanel key="threatmodel" onRefine={handleRefine} sessionId={threatModelSessionId} onSave={handlePanelSave} initialSession={panelSession("threatmodel")} />;
    if (mode === "reliability") return <ReliabilityPanel key="reliability" onRefine={handleRefine} sessionId={reliabilitySessionId} onSave={handlePanelSave} initialSession={panelSession("reliability")} />;
    if (mode === "troubleshoot") return <TroubleshootingPanel key="troubleshoot" onRefine={handleRefine} sessionId={troubleshootSessionId} onSave={handlePanelSave} initialSession={panelSession("troubleshoot")} />;
    if (mode === "reference") return <ReferenceLibrary key="reference" />;
    if (mode === "strategy") return <StrategyPanel key="strategy" onRefine={handleRefine} sessionId={strategySessionId} onSave={handlePanelSave} initialSession={panelSession("strategy")} workloadContext={workloadContext} />;
    if (mode === "whatsnew") return <WhatsNewPanel key="whatsnew" />;
    if (mode === "servicehealth") return <ServiceHealthPanel key="servicehealth" incidents={healthIncidents} loading={healthLoading} error={healthError} lastChecked={healthLastChecked} onRefresh={refreshHealth} />;
    if (mode === "admin") return <MetricsDashboard key="admin" />;
    if (mode === "presentation") return <PresentationPanel key="presentation" />;
    if (mode === "codegen") return <CodegenPanel key="codegen" onRefine={handleRefine} />;
    if (mode === "learningplan") return <LearningPlanPanel key="learningplan" />;
    if (mode === "bootstrap") return <BootstrapPanel key="bootstrap" onRefine={handleRefine} />;
    if (mode === "sizing") return <SizingPanel key="sizing" onRefine={handleRefine} sessionId={sizingSessionId} onSave={handlePanelSave} initialSession={panelSession("sizing")} />;
    if (mode === "tco") return <TCOPanel key="tco" onRefine={handleRefine} sessionId={tcoSessionId} onSave={handlePanelSave} initialSession={panelSession("tco")} />;
    if (ADVISOR_MODES.includes(mode)) {
      return (
        <AdvisorPanel
          key={chatKey}
          mode={mode}
          onModeChange={handleModeChange}
          conversationId={selectedConversation?.id}
          initialMessages={initialMessages}
          suggestedReplies={refinementSeed?.suggestedReplies}
          modelConfig={settings.mode_models[mode]}
          workloadContext={workloadContext}
          onOpenContext={() => setContextOpen(true)}
          onFork={handleFork}
          onSave={(id, m, msgs) => upsert(id, m, msgs)}
          onContinueIn={handleContinueIn}
        />
      );
    }
    return null;
  }

  return (
    <FluentProvider theme={darkMode ? azureDarkTheme : azureLightTheme}>
      <div className={styles.root}>
        <SideNav
          mode={mode}
          onModeChange={handleModeChange}
          collapsed={navCollapsed}
          onToggleCollapsed={() => setNavCollapsed((v) => !v)}
          badgeCounts={incidentCount > 0 ? { servicehealth: incidentCount } : {}}
        />
        <div className={styles.main}>
          <Header
            mode={mode}
            darkMode={darkMode}
            onToggleDark={() => setDarkMode((d) => !d)}
            onOpenHistory={() => setHistoryOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenContext={() => setContextOpen(true)}
          />
          <div className={styles.content}>{renderMode()}</div>
        </div>
      </div>
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        conversations={conversations}
        onLoad={handleLoadConversation}
        onDelete={remove}
        onClear={clear}
      />
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={saveSettings}
        githubTokenConfigured={githubTokenConfigured}
        onSaveGithubToken={setGithubToken}
        onClearGithubToken={clearGithubToken}
      />
      <WorkloadContextPanel
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        context={workloadContext}
        onSave={(ctx) => { setWorkloadContext(ctx); setContextOpen(false); }}
        onClear={() => { clearContext(); setContextOpen(false); }}
      />
      <TelemetryDebugDrawer open={telemetryOpen} onClose={() => setTelemetryOpen(false)} />
    </FluentProvider>
  );
}
