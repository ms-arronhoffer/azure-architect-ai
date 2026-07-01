import { useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  SearchBox,
  Spinner,
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
  ArrowUploadRegular,
  CloudAddRegular,
} from "@fluentui/react-icons";
import { TOASTER_ID } from "../constants/toaster";
import { useSkillShowcase, useSkills } from "../hooks/useSkills";
import type { ShowcaseSkill } from "../types";

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
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
  },
  search: { minWidth: "280px", flex: "1 1 280px", maxWidth: "440px" },
  tagRow: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS },
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
  cardTags: { display: "flex", gap: tokens.spacingHorizontalXS, flexWrap: "wrap" },
  cardActions: { display: "flex", gap: tokens.spacingHorizontalS, marginTop: "auto" },
  empty: {
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  loading: { display: "flex", justifyContent: "center", padding: tokens.spacingVerticalXXL },
  error: { padding: tokens.spacingVerticalM, color: tokens.colorPaletteRedForeground1 },
});

export default function SkillShowcasePanel() {
  const styles = useStyles();
  const {
    visible,
    allTags,
    title,
    subtitle,
    loading,
    error,
    search,
    setSearch,
    activeTag,
    setActiveTag,
    refresh,
    install,
  } = useSkillShowcase();
  const { upload, refresh: refreshSkills } = useSkills();
  const { dispatchToast } = useToastController(TOASTER_ID);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
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

  async function handleInstall(item: ShowcaseSkill) {
    setInstallingId(item.id);
    try {
      const created = await install(item.id);
      if (created) {
        await refreshSkills();
        notify("success", "Skill installed", `"${item.title}" is now in My Skills.`);
      } else {
        notify("error", "Install failed", "Could not install this skill. Please try again.");
      }
    } finally {
      setInstallingId(null);
    }
  }

  async function handleUploadFile(file: File) {
    setUploading(true);
    try {
      const created = await upload(file);
      if (created) {
        await refreshSkills();
        notify("success", "Skill uploaded", `"${created.name}" was added to My Skills.`);
      } else {
        notify("error", "Upload failed", "The package was rejected. Check the manifest and try again.");
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
          <Text size={700} weight="semibold">{title}</Text>
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
        {subtitle && <Text className={styles.subtitle}>{subtitle}</Text>}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchBox
            placeholder="Search skills by title, description, or tag"
            value={search}
            onChange={(_, d) => setSearch(d.value)}
          />
        </div>
        <div className={styles.tagRow}>
          <Button
            size="small"
            appearance={activeTag === "All" ? "primary" : "outline"}
            onClick={() => setActiveTag("All")}
          >
            All
          </Button>
          {allTags.map((tag) => (
            <Button
              key={tag}
              size="small"
              appearance={activeTag === tag ? "primary" : "outline"}
              onClick={() => setActiveTag(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}><Spinner label="Loading skills…" /></div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          <Text>No skills match the current filter. Upload your own package to get started.</Text>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((item) => (
            <Card key={item.id} className={styles.card}>
              <CardHeader
                header={<Text weight="semibold">{item.title}</Text>}
                description={
                  <div className={styles.cardMeta}>
                    {item.featured && <Badge appearance="filled" color="brand">Featured</Badge>}
                    <Text size={200}>{item.category}</Text>
                    <Text size={200}>· {item.downloads} installs</Text>
                    {item.author && <Text size={200}>· {item.author}</Text>}
                  </div>
                }
              />
              <Text className={styles.cardDesc}>{item.description}</Text>
              <div className={styles.cardTags}>
                {item.tags.map((t) => (
                  <Badge key={t} appearance="tint" color="informative">{t}</Badge>
                ))}
              </div>
              <div className={styles.cardActions}>
                <Button
                  appearance="primary"
                  icon={<CloudAddRegular />}
                  onClick={() => handleInstall(item)}
                  disabled={installingId === item.id}
                >
                  {installingId === item.id ? "Installing…" : "Install"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
