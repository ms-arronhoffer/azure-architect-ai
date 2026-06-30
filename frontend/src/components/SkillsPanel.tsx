import { lazy, Suspense, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Spinner,
  Switch,
  Text,
  makeStyles,
  tokens,
  useToastController,
  Toast,
  ToastTitle,
  ToastBody,
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  ArrowLeftRegular,
  ArrowUploadRegular,
  DeleteRegular,
  PlayRegular,
  ShareRegular,
} from "@fluentui/react-icons";
import { useRef } from "react";
import { TOASTER_ID } from "../constants/toaster";
import { useSkills } from "../hooks/useSkills";
import type { UserSkill } from "../types";

const ChatPanel = lazy(() => import("./ChatPanel"));

const useStyles = makeStyles({
  root: {
    flex: 1,
    overflow: "auto",
    padding: tokens.spacingHorizontalXXL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  hero: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  heroRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  subtitle: { color: tokens.colorNeutralForeground2, maxWidth: "780px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: tokens.spacingHorizontalL,
  },
  card: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  cardDesc: { color: tokens.colorNeutralForeground2 },
  cardMeta: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
    flexWrap: "wrap",
    color: tokens.colorNeutralForeground3,
  },
  cardActions: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
    marginTop: "auto",
    flexWrap: "wrap",
    alignItems: "center",
  },
  empty: {
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  loading: { display: "flex", justifyContent: "center", padding: tokens.spacingVerticalXXL },
  error: { padding: tokens.spacingVerticalM, color: tokens.colorPaletteRedForeground1 },
  runner: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
  runnerHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalL,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

export default function SkillsPanel() {
  const styles = useStyles();
  const { skills, loading, error, refresh, upload, update, remove, publish, exportUrl } = useSkills();
  const { dispatchToast } = useToastController(TOASTER_ID);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<UserSkill | null>(null);
  const [uploading, setUploading] = useState(false);

  function notify(intent: "success" | "error", title: string, body?: string) {
    dispatchToast(
      <Toast>
        <ToastTitle>{title}</ToastTitle>
        {body && <ToastBody>{body}</ToastBody>}
      </Toast>,
      { intent },
    );
  }

  async function handleUploadFile(file: File) {
    setUploading(true);
    try {
      const created = await upload(file);
      if (created) notify("success", "Skill uploaded", `"${created.name}" was added.`);
      else notify("error", "Upload failed", "The package was rejected. Check the manifest and try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleToggle(skill: UserSkill, enabled: boolean) {
    const updated = await update(skill.id, { enabled });
    if (!updated) notify("error", "Update failed", "Could not change the skill state.");
  }

  async function handleDelete(skill: UserSkill) {
    const ok = await remove(skill.id);
    if (ok) notify("success", "Skill removed", `"${skill.name}" was deleted.`);
    else notify("error", "Delete failed");
  }

  async function handlePublish(skill: UserSkill) {
    const ok = await publish(skill.id);
    if (ok) notify("success", "Published", `"${skill.name}" is now in the Skill Showcase.`);
    else notify("error", "Publish failed");
  }

  if (active) {
    return (
      <div className={styles.runner}>
        <div className={styles.runnerHeader}>
          <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => setActive(null)}>
            Back to My Skills
          </Button>
          <Text weight="semibold">{active.name}</Text>
          <Text size={200} className={styles.subtitle}>{active.description}</Text>
        </div>
        <Suspense fallback={<div className={styles.loading}><Spinner label="Loading…" /></div>}>
          <ChatPanel key={active.id} mode="qa" skillId={active.id} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleUploadFile(f);
        }}
      />
      <div className={styles.hero}>
        <div className={styles.heroRow}>
          <Text size={700} weight="semibold">My Skills</Text>
          <div style={{ display: "flex", gap: tokens.spacingHorizontalS }}>
            <Button
              appearance="subtle"
              icon={<ArrowClockwiseRegular />}
              onClick={() => refresh()}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              appearance="secondary"
              icon={<ArrowDownloadRegular />}
              as="a"
              href="/api/skills/sample"
            >
              Download sample
            </Button>
            <Button
              appearance="primary"
              icon={<ArrowUploadRegular />}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Upload skill"}
            </Button>
          </div>
        </div>
        <Text className={styles.subtitle}>
          Skills augment the assistant with your own instructions and grounding knowledge. Enable a
          skill to use it, or publish it to share with your team.
        </Text>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}><Spinner label="Loading skills…" /></div>
      ) : skills.length === 0 ? (
        <div className={styles.empty}>
          <Text>You have no skills yet. Upload a package or install one from the Skill Showcase.</Text>
        </div>
      ) : (
        <div className={styles.grid}>
          {skills.map((skill) => (
            <Card key={skill.id} className={styles.card}>
              <CardHeader
                header={<Text weight="semibold">{skill.name}</Text>}
                description={
                  <div className={styles.cardMeta}>
                    <Badge appearance="tint" color={skill.source === "showcase" ? "informative" : "brand"}>
                      {skill.source}
                    </Badge>
                    <Text size={200}>{skill.category}</Text>
                    <Text size={200}>· v{skill.version}</Text>
                  </div>
                }
              />
              <Text className={styles.cardDesc}>{skill.description}</Text>
              <div className={styles.cardActions}>
                <Switch
                  checked={skill.enabled}
                  label={skill.enabled ? "Enabled" : "Disabled"}
                  onChange={(_, d) => handleToggle(skill, d.checked)}
                />
                <Button
                  appearance="primary"
                  icon={<PlayRegular />}
                  disabled={!skill.enabled}
                  onClick={() => setActive(skill)}
                >
                  Use
                </Button>
                <Button appearance="subtle" icon={<ShareRegular />} onClick={() => handlePublish(skill)}>
                  Publish
                </Button>
                <Button appearance="subtle" icon={<ArrowDownloadRegular />} as="a" href={exportUrl(skill.id)}>
                  Export
                </Button>
                <Button
                  appearance="subtle"
                  icon={<DeleteRegular />}
                  onClick={() => handleDelete(skill)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
