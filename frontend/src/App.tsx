import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { FluentProvider, makeStyles, tokens, Spinner, Toaster, useToastController, Toast, ToastTitle, ToastBody } from "@fluentui/react-components";
import { azureDarkTheme, azureLightTheme } from "./theme";
// Shell chrome — always mounted, kept eager so the app paints immediately.
import SideNav from "./components/SideNav";
import Header from "./components/Header";
import HistoryDrawer from "./components/HistoryDrawer";
import CommandPalette from "./components/CommandPalette";
import KeyboardShortcutsDialog from "./components/KeyboardShortcutsDialog";
import OnboardingTour, { shouldShowOnboarding } from "./components/OnboardingTour";
import SettingsDrawer from "./components/SettingsDrawer";
import HowToDrawer from "./components/HowToDrawer";
import WorkloadContextPanel from "./components/WorkloadContextPanel";
import TelemetryDebugDrawer from "./components/TelemetryDebugDrawer";
import { ToastDismissButton } from "./components/ToastDismissButton";
import EngagementDrawer from "./components/EngagementDrawer";
// Mode panels — code-split so a visitor only downloads the panel they open.
// Heavy transitive deps (docx, xlsx, jspdf, jszip, react-syntax-highlighter)
// ride along in each panel's chunk instead of the initial bundle.
const AdvisorPanel = lazy(() => import("./components/AdvisorPanel"));
const NetworkDeskPanel = lazy(() => import("./components/NetworkDeskPanel"));
const ComputeDeskPanel = lazy(() => import("./components/ComputeDeskPanel"));
const AIDeskPanel = lazy(() => import("./components/AIDeskPanel"));
const DataDeskPanel = lazy(() => import("./components/DataDeskPanel"));
const ArchitecturePanel = lazy(() => import("./components/ArchitecturePanel"));
const WAFPanel = lazy(() => import("./components/WAFPanel"));
const ReviewPanel = lazy(() => import("./components/ReviewPanel"));
const DRBCPanel = lazy(() => import("./components/DRBCPanel"));
const ReferenceLibrary = lazy(() => import("./components/ReferenceLibrary"));
const StrategyPanel = lazy(() => import("./components/StrategyPanel"));
const PresentationPanel = lazy(() => import("./components/PresentationPanel"));
const CodegenPanel = lazy(() => import("./components/CodegenPanel"));
const LearningPlanPanel = lazy(() => import("./components/LearningPlanPanel"));
const PipelineForgePanel = lazy(() => import("./components/PipelineForgePanel"));
const RunbookStudioPanel = lazy(() => import("./components/RunbookStudioPanel"));
const NamingStandardsPanel = lazy(() => import("./components/NamingStandardsPanel"));
const IntakePanel = lazy(() => import("./components/IntakePanel"));
const IntakeChatPanel = lazy(() => import("./components/IntakeChatPanel"));
const AnalysisPanel = lazy(() => import("./components/AnalysisPanel"));
const CostOptimizePanel = lazy(() => import("./components/CostOptimizePanel"));
const PricingDeskPanel = lazy(() => import("./components/PricingDeskPanel"));
const DemoBuildPanel = lazy(() => import("./components/DemoBuildPanel"));
const LandingZonePanel = lazy(() => import("./components/LandingZonePanel"));
const ThreatModelPanel = lazy(() => import("./components/ThreatModelPanel"));
const ReliabilityPanel = lazy(() => import("./components/ReliabilityPanel"));
const TroubleshootingPanel = lazy(() => import("./components/TroubleshootingPanel"));
const WhatsNewPanel = lazy(() => import("./components/WhatsNewPanel"));
const ServiceHealthPanel = lazy(() => import("./components/ServiceHealthPanel"));
const ModelLifecyclePanel = lazy(() => import("./components/ModelLifecyclePanel"));
const ModelMigrationPanel = lazy(() => import("./components/ModelMigrationPanel"));
const MetricsDashboard = lazy(() => import("./components/MetricsDashboard"));
const FabricPlannerPanel = lazy(() => import("./components/FabricPlannerPanel"));
const AdfPipelinePanel = lazy(() => import("./components/AdfPipelinePanel"));
const MedallionDesignerPanel = lazy(() => import("./components/MedallionDesignerPanel"));
const DemoShowcasePanel = lazy(() => import("./components/DemoShowcasePanel"));
const RefArchPanel = lazy(() => import("./components/RefArchPanel"));
const AgentPanel = lazy(() => import("./components/AgentPanel"));
import {
  ADVISOR_MODES,
  ARCH_MODES,
  NETWORK_DESK_MODES,
  COMPUTE_DESK_MODES,
  AI_DESK_MODES,
  DATA_DESK_MODES,
  PANEL_MODES,
  isAgentToken,
  unifiedAgentsEnabled,
} from "./constants/modeGroups";
import type { AgentToken } from "./constants/modeGroups";
import { useConversationHistory } from "./hooks/useConversationHistory";
import { useWorkloadContext } from "./hooks/useWorkloadContext";
import { useSettings } from "./hooks/useSettings";
import { useServiceHealth } from "./hooks/useServiceHealth";
import { useEngagements } from "./hooks/useEngagements";
import { useWorkloadSpec } from "./hooks/useWorkloadSpec";
import { useFavorites } from "./hooks/useFavorites";
import { track } from "./utils/telemetry";
import { setErrorNotifier } from "./config/api";
import { loadRuntimeConfig } from "./config/runtimeFlags";
import { useUnifiedAgents } from "./hooks/useUnifiedAgents";
import { TOASTER_ID } from "./constants/toaster";
import { DemoBuildProvider } from "./contexts/DemoBuildContext";
import type { Mode, ConversationRecord, ChatMessage, ContinueInSeed, DemoBuilderSeed } from "./types";

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
  panelFallback: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
});

const LAST_MODE_KEY = "azure_last_mode";

// Home mode for the currently active navigation surface. Resolved at runtime so
// it follows the unified-agents flag without a rebuild (see config/runtimeFlags).
function defaultMode(): Mode {
  return unifiedAgentsEnabled() ? "ask" : "qa";
}

function loadInitialMode(): Mode {
  try {
    const saved = localStorage.getItem(LAST_MODE_KEY) as Mode | null;
    if (saved) return saved;
  } catch { /* ignore */ }
  return defaultMode();
}

export default function App() {
  const styles = useStyles();
  const [darkMode, setDarkMode] = useState(true);
  const [mode, setMode] = useState<Mode>(loadInitialMode);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [engagementsOpen, setEngagementsOpen] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(shouldShowOnboarding);
  const [selectedConversation, setSelectedConversation] = useState<ConversationRecord | null>(null);
  const [refinementSeed, setRefinementSeed] = useState<{ id: string; messages: ChatMessage[]; suggestedReplies?: string[] } | null>(null);
  const [selectedPanelSession, setSelectedPanelSession] = useState<ConversationRecord | null>(null);
  const { conversations, saveStatus, upsert, remove, clear, fork } = useConversationHistory();
  const { context: workloadContext, setContext: setWorkloadContext, clearContext } = useWorkloadContext();
  const { settings, saveSettings, githubTokenConfigured, setGithubToken, clearGithubToken } = useSettings();
  const { incidents: healthIncidents, incidentCount, loading: healthLoading, error: healthError, lastChecked: healthLastChecked, refresh: refreshHealth } = useServiceHealth();
  const engagementsApi = useEngagements();
  const { setSpec: setWorkloadSpec } = useWorkloadSpec();
  const { favorites, toggleFavorite } = useFavorites();
  const { enabled: unifiedAgents, setEnabled: setUnifiedAgents } = useUnifiedAgents();
  const [analyzeAutoStart, setAnalyzeAutoStart] = useState(false);
  const [demoBuildSeed, setDemoBuildSeed] = useState<DemoBuilderSeed | null>(null);

  // Fetch runtime feature flags once at startup so the unified-agents surface
  // reflects the server default without a frontend rebuild.
  useEffect(() => {
    void loadRuntimeConfig();
  }, []);

  // Toggle the unified-agents surface and jump to the new surface's home mode so
  // the user never lands on a mode that no longer has a nav entry.
  function handleToggleUnifiedAgents(value: boolean) {
    setUnifiedAgents(value);
    const home: Mode = value ? "ask" : "qa";
    setMode(home);
    try { localStorage.setItem(LAST_MODE_KEY, home); } catch { /* ignore */ }
  }

  const { dispatchToast } = useToastController(TOASTER_ID);
  useEffect(() => {
    setErrorNotifier((message) => {
      dispatchToast(
        <Toast>
          <ToastTitle action={<ToastDismissButton />}>Error</ToastTitle>
          <ToastBody>{message}</ToastBody>
        </Toast>,
        { intent: "error", timeout: 5000 }
      );
    });
    return () => setErrorNotifier(null);
  }, [dispatchToast]);

  const wafSessionId = useRef(crypto.randomUUID()).current;
  const reviewSessionId = useRef(crypto.randomUUID()).current;
  const drbcSessionId = useRef(crypto.randomUUID()).current;
  const pipelineForgeSessionId = useRef(crypto.randomUUID()).current;
  const runbookStudioSessionId = useRef(crypto.randomUUID()).current;
  const namingStandardsSessionId = useRef(crypto.randomUUID()).current;
  const threatModelSessionId = useRef(crypto.randomUUID()).current;
  const reliabilitySessionId = useRef(crypto.randomUUID()).current;
  const landingZoneSessionId = useRef(crypto.randomUUID()).current;
  const troubleshootSessionId = useRef(crypto.randomUUID()).current;
  const strategySessionId = useRef(crypto.randomUUID()).current;

  function handleModeChange(m: Mode) {
    setMode(m);
    try { localStorage.setItem(LAST_MODE_KEY, m); } catch { /* ignore */ }
    setSelectedConversation(null);
    setSelectedPanelSession(null);
    setRefinementSeed(null);
    setAnalyzeAutoStart(false);
    track({ kind: "mode_open", mode: m });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+Shift+T — Telemetry debug drawer
      if (e.ctrlKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault();
        setTelemetryOpen((v) => !v);
        return;
      }
      // Ctrl+Shift+D — Toggle dark mode
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setDarkMode((d) => !d);
        return;
      }
      // Ctrl+Shift+N — New conversation (reset current mode)
      if (e.ctrlKey && e.shiftKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        setSelectedConversation(null);
        setSelectedPanelSession(null);
        setRefinementSeed(null);
        setAnalyzeAutoStart(false);
        // Force re-render by toggling mode back to itself
        handleModeChange(mode);
        return;
      }
      // Ctrl+K — Command palette
      if (e.ctrlKey && !e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
        return;
      }
      // Ctrl+H — History drawer
      if (e.ctrlKey && !e.shiftKey && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        setHistoryOpen((v) => !v);
        return;
      }
      // Ctrl+/ — Keyboard shortcuts dialog
      if (e.ctrlKey && !e.shiftKey && e.key === "/") {
        e.preventDefault();
        setShortcutsDialogOpen((v) => !v);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleContinueIn(targetMode: Mode, seed: ContinueInSeed) {
    if (typeof seed === "string") {
      const seedMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: seed };
      setRefinementSeed({ id: crypto.randomUUID(), messages: [seedMsg] });
      setAnalyzeAutoStart(false);
    } else {
      if (seed.demoSeed) setDemoBuildSeed(seed.demoSeed);
      if (seed.spec) setWorkloadSpec(seed.spec);
      setRefinementSeed(null);
      setAnalyzeAutoStart(Boolean(seed.autoStart));
    }
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
    // Route the unified "architect" agent through ArchitecturePanel so it
    // gets the full multi-artifact pipeline (diagram + runbook + bicep +
    // cost + adr + gantt + waf) and the split-pane layout. Other unified
    // agents stay on the lighter AgentPanel surface.
    if (mode === "architect") {
      return (
        <ArchitecturePanel
          key={selectedPanelSession?.id ?? refinementSeed?.id ?? "architect"}
          mode="architecture"
          onRefine={handleRefine}
          onModeChange={handleModeChange}
          workloadContext={workloadContext}
          onSave={(id, m, msgs, sr) => handlePanelSave(id, m, msgs, sr)}
          initialSession={selectedPanelSession ?? undefined}
          initialMessages={initialMessages}
        />
      );
    }
    if (mode === "ask" || isAgentToken(mode)) {
      return (
        <AgentPanel
          key={chatKey}
          agent={mode as AgentToken | "ask"}
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
    if (mode === "intake") {
      return <IntakePanel key="intake" onContinueIn={handleContinueIn} />;
    }
    if (mode === "analyze") {
      return <AnalysisPanel key="analyze" onRefine={handleRefine} onContinueIn={handleContinueIn} autoStart={analyzeAutoStart} onAutoStartConsumed={() => setAnalyzeAutoStart(false)} />;
    }
    if (mode === "cost-optimize") {
      return <CostOptimizePanel key="cost-optimize" />;
    }
    if (mode === "pricing-desk") {
      return (
        <PricingDeskPanel
          key="pricing-desk"
          workloadContext={workloadContext}
          initialMessages={initialMessages}
          conversationId={selectedConversation?.id}
          onSave={(id, m, msgs) => upsert(id, m, msgs)}
        />
      );
    }
    if (mode === "demo-build") {
      return <DemoBuildPanel key="demo-build" initialSeed={demoBuildSeed} onSeedConsumed={() => setDemoBuildSeed(null)} />;
    }
    if (ARCH_MODES.includes(mode)) {
      return (
        <ArchitecturePanel
          key={selectedPanelSession?.id ?? refinementSeed?.id ?? "arch"}
          mode={mode}
          onRefine={handleRefine}
          onModeChange={handleModeChange}
          workloadContext={workloadContext}
          onSave={(id, m, msgs, sr) => handlePanelSave(id, m, msgs, sr)}
          initialSession={ARCH_MODES.includes(selectedPanelSession?.mode ?? "" as Mode) ? selectedPanelSession ?? undefined : undefined}
          initialMessages={initialMessages}
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
    if (mode === "modellifecycle") return <ModelLifecyclePanel key="modellifecycle" />;
    if (mode === "modelmigration") return <ModelMigrationPanel key="modelmigration" />;
    if (mode === "admin") return <MetricsDashboard key="admin" />;
    if (mode === "fabricplanner") return <FabricPlannerPanel key="fabricplanner" />;
    if (mode === "adfpipeline") return <AdfPipelinePanel key="adfpipeline" />;
    if (mode === "medalliondesigner") return <MedallionDesignerPanel key="medalliondesigner" />;
    if (mode === "showcase") return <DemoShowcasePanel key="showcase" onContinueIn={handleContinueIn} />;
    if (mode === "refarch") return <RefArchPanel key="refarch" onContinueIn={handleContinueIn} />;
    if (mode === "intakechat") return <IntakeChatPanel key="intakechat" onContinueIn={handleContinueIn} />;
    if (mode === "presentation") return <PresentationPanel key="presentation" />;
    if (mode === "codegen") return <CodegenPanel key="codegen" onRefine={handleRefine} />;
    if (mode === "learningplan") return <LearningPlanPanel key="learningplan" />;
    if (mode === "pipelineforge") return <PipelineForgePanel key="pipelineforge" onRefine={handleRefine} sessionId={pipelineForgeSessionId} onSave={handlePanelSave} initialSession={panelSession("pipelineforge")} />;
    if (mode === "runbookstudio") return <RunbookStudioPanel key="runbookstudio" onRefine={handleRefine} sessionId={runbookStudioSessionId} onSave={handlePanelSave} initialSession={panelSession("runbookstudio")} />;
    if (mode === "namingstandards") return <NamingStandardsPanel key="namingstandards" onRefine={handleRefine} sessionId={namingStandardsSessionId} onSave={handlePanelSave} initialSession={panelSession("namingstandards")} />;
    if (NETWORK_DESK_MODES.includes(mode)) {
      return (
        <NetworkDeskPanel
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
    if (COMPUTE_DESK_MODES.includes(mode)) {
      return (
        <ComputeDeskPanel
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
    if (AI_DESK_MODES.includes(mode)) {
      return (
        <AIDeskPanel
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
    if (DATA_DESK_MODES.includes(mode)) {
      return (
        <DataDeskPanel
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
      <DemoBuildProvider>
      <div className={styles.root}>
        <SideNav
          mode={mode}
          onModeChange={handleModeChange}
          collapsed={navCollapsed}
          onToggleCollapsed={() => setNavCollapsed((v) => !v)}
          badgeCounts={incidentCount > 0 ? { servicehealth: incidentCount } : {}}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
        />
        <div className={styles.main}>
          <Header
            mode={mode}
            darkMode={darkMode}
            onToggleDark={() => setDarkMode((d) => !d)}
            onOpenHistory={() => setHistoryOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenContext={() => setContextOpen(true)}
            onOpenHowTo={() => setHowToOpen(true)}
            workloadContext={workloadContext}
            saveStatus={saveStatus}
            engagements={engagementsApi.engagements}
            activeEngagement={engagementsApi.active}
            onSelectEngagement={engagementsApi.setActiveId}
            onOpenEngagements={() => setEngagementsOpen(true)}
          />
          <div className={styles.content}>
            <Suspense fallback={<div className={styles.panelFallback}><Spinner label="Loading…" /></div>}>
              {renderMode()}
            </Suspense>
          </div>
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
        unifiedAgents={unifiedAgents}
        onToggleUnifiedAgents={handleToggleUnifiedAgents}
      />
      <HowToDrawer
        open={howToOpen}
        onClose={() => setHowToOpen(false)}
      />
      <EngagementDrawer
        open={engagementsOpen}
        onClose={() => setEngagementsOpen(false)}
        engagements={engagementsApi.engagements}
        active={engagementsApi.active}
        onSelect={engagementsApi.setActiveId}
        onCreate={engagementsApi.create}
        onUpdate={engagementsApi.update}
        onDelete={engagementsApi.remove}
      />
      <WorkloadContextPanel
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        context={workloadContext}
        onSave={(ctx) => { setWorkloadContext(ctx); setContextOpen(false); }}
        onClear={() => { clearContext(); setContextOpen(false); }}
      />
      <TelemetryDebugDrawer open={telemetryOpen} onClose={() => setTelemetryOpen(false)} />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onSelect={handleModeChange}
        currentMode={mode}
        favorites={favorites}
      />
      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen}
        onClose={() => setShortcutsDialogOpen(false)}
      />
      {onboardingOpen && (
        <OnboardingTour onClose={() => setOnboardingOpen(false)} />
      )}
      <Toaster toasterId={TOASTER_ID} position="top-end" />
      </DemoBuildProvider>
    </FluentProvider>
  );
}
