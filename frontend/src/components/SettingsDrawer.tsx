import { useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  Select,
  Divider,
} from "@fluentui/react-components";
import { DismissRegular, EyeRegular, EyeOffRegular, SaveRegular } from "@fluentui/react-icons";
import type { Mode, ModelConfig, UserSettings } from "../types";

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  azure: ["", "gpt-4o-mini", "gpt-4.1"],
  "github-models": [
    "gpt-4o",
    "gpt-4o-mini",
    "claude-3-5-sonnet-20241022",
    "llama-3.1-70b-instruct",
    "mistral-large",
    "phi-3.5-mini-instruct",
  ],
  "github-copilot": ["gpt-4o"],
};

const PROVIDER_LABELS: Record<string, string> = {
  azure: "Azure OpenAI",
  "github-models": "GitHub Models",
  "github-copilot": "GitHub Copilot Enterprise",
};

const TOOL_INCOMPATIBLE = new Set([
  "llama-3.1-70b-instruct",
  "mistral-large",
  "phi-3.5-mini-instruct",
]);

const CHAT_MODES: Array<{ mode: Mode; label: string }> = [
  { mode: "qa", label: "Expert Q&A" },
  { mode: "situation", label: "Situation Advisor" },
  { mode: "certprep", label: "Cert Prep" },
  { mode: "learningplan", label: "Learning Plan" },
  { mode: "regional", label: "Regional Advisor" },
  { mode: "compliance", label: "Compliance Mapping" },
  { mode: "migration", label: "Migration Assessment" },
  { mode: "cost", label: "Cost Optimization" },
  { mode: "monitoring", label: "Monitoring Config" },
  { mode: "compare", label: "Service Comparison" },
  { mode: "codegen", label: "Code Generator" },
];

const useStyles = makeStyles({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    padding: "16px 20px 32px",
    overflowY: "auto",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  sectionTitle: {
    fontWeight: 600,
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: tokens.colorNeutralForeground3,
  },
  tokenRow: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
  },
  tokenInput: {
    flex: 1,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "7px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
  },
  modeRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  modeLabel: {
    flex: 1,
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    minWidth: 0,
  },
  warning: {
    marginTop: "4px",
    fontSize: "11px",
    color: tokens.colorStatusWarningForeground1,
  },
  saveRow: {
    display: "flex",
    justifyContent: "flex-end",
    paddingTop: "8px",
  },
});

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSave: (s: UserSettings) => void;
  githubTokenConfigured: boolean;
  onSaveGithubToken: (token: string) => Promise<void>;
  onClearGithubToken: () => Promise<void>;
}

export default function SettingsDrawer({
  open,
  onClose,
  settings,
  onSave,
  githubTokenConfigured,
  onSaveGithubToken,
  onClearGithubToken,
}: SettingsDrawerProps) {
  const styles = useStyles();
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Sync model selections when external settings change
  if (open && Object.keys(draft.mode_models).length === 0 && Object.keys(settings.mode_models).length > 0) {
    setDraft(settings);
  }

  function setModeConfig(mode: Mode, patch: Partial<ModelConfig>) {
    const current = draft.mode_models[mode] ?? { provider: "azure", model: "" };
    const updated: ModelConfig = { ...current, ...patch };
    setDraft((d) => ({
      ...d,
      mode_models: { ...d.mode_models, [mode]: updated },
    }));
  }

  function handleProviderChange(mode: Mode, provider: string) {
    const defaultModel = MODELS_BY_PROVIDER[provider]?.[0] ?? "";
    setModeConfig(mode, { provider: provider as ModelConfig["provider"], model: defaultModel });
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  async function handleSaveToken() {
    if (!tokenInput.trim()) return;
    setTokenSaving(true);
    setTokenError(null);
    try {
      await onSaveGithubToken(tokenInput.trim());
      setTokenInput("");
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : "Failed to save token");
    } finally {
      setTokenSaving(false);
    }
  }

  async function handleClearToken() {
    setTokenSaving(true);
    setTokenError(null);
    try {
      await onClearGithubToken();
      setTokenInput("");
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : "Failed to clear token");
    } finally {
      setTokenSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(_, d) => { if (!d.open) onClose(); }}
      position="end"
      size="medium"
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onClose} />
          }
        >
          Settings
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <div className={styles.body}>
          {/* GitHub PAT */}
          <div className={styles.section}>
            <Text className={styles.sectionTitle}>GitHub Personal Access Token</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Required for GitHub Models, Copilot Enterprise, and repo push. Stored
              encrypted server-side; never returned to the browser.
            </Text>
            <Text size={200} style={{ color: githubTokenConfigured ? tokens.colorPaletteGreenForeground1 : tokens.colorNeutralForeground3 }}>
              Status: {githubTokenConfigured ? "Configured" : "Not configured"}
            </Text>
            <div className={styles.tokenRow}>
              <input
                type={showToken ? "text" : "password"}
                className={styles.tokenInput}
                placeholder={githubTokenConfigured ? "Enter a new token to replace" : "ghp_..."}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
              <Button
                appearance="subtle"
                size="small"
                icon={showToken ? <EyeOffRegular /> : <EyeRegular />}
                onClick={() => setShowToken((v) => !v)}
              />
            </div>
            <div className={styles.tokenRow} style={{ gap: 8 }}>
              <Button
                size="small"
                appearance="primary"
                disabled={tokenSaving || !tokenInput.trim()}
                onClick={handleSaveToken}
              >
                {githubTokenConfigured ? "Replace token" : "Save token"}
              </Button>
              {githubTokenConfigured && (
                <Button size="small" disabled={tokenSaving} onClick={handleClearToken}>
                  Clear token
                </Button>
              )}
            </div>
            {tokenError && <Text className={styles.warning}>{tokenError}</Text>}
          </div>

          <Divider />

          {/* Per-mode model selection */}
          <div className={styles.section}>
            <Text className={styles.sectionTitle}>Model Selection (per mode)</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Leave as Azure OpenAI to use the default deployment.
            </Text>
            {CHAT_MODES.map(({ mode, label }) => {
              const mc = draft.mode_models[mode] ?? { provider: "azure", model: "" };
              const models = MODELS_BY_PROVIDER[mc.provider] ?? [];
              const isIncompatible = TOOL_INCOMPATIBLE.has(mc.model);
              return (
                <div key={mode}>
                  <div className={styles.modeRow}>
                    <Text className={styles.modeLabel}>{label}</Text>
                    <Select
                      size="small"
                      value={mc.provider}
                      onChange={(_, d) => handleProviderChange(mode, d.value)}
                    >
                      {Object.entries(PROVIDER_LABELS).map(([val, lbl]) => (
                        <option key={val} value={val}>{lbl}</option>
                      ))}
                    </Select>
                    {mc.provider !== "azure" && (
                      <Select
                        size="small"
                        value={mc.model}
                        onChange={(_, d) => setModeConfig(mode, { model: d.value })}
                      >
                        {models.map((m) => (
                          <option key={m} value={m}>{m || "(default)"}</option>
                        ))}
                      </Select>
                    )}
                  </div>
                  {isIncompatible && (
                    <Text className={styles.warning}>
                      ⚠ Tool calling disabled — AI-cited answers and structured results unavailable for this model.
                    </Text>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.saveRow}>
            <Button appearance="primary" icon={<SaveRegular />} onClick={handleSave}>
              Save Settings
            </Button>
          </div>
        </div>
      </DrawerBody>
    </Drawer>
  );
}
