import { useMemo, useState } from "react";
import {
  Button,
  SearchBox,
  Spinner,
  Text,
  makeStyles,
  tokens,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
} from "@fluentui/react-components";
import { AddRegular, ArrowClockwiseRegular } from "@fluentui/react-icons";
import { useRefArch } from "../hooks/useRefArch";
import type { ReferenceArch, Mode } from "../types";
import { RefArchCard } from "./RefArchCard";
import { RefArchFormDialog } from "./RefArchFormDialog";

const useStyles = makeStyles({
  root: {
    flex: 1,
    overflow: "auto",
    padding: tokens.spacingHorizontalXXL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  hero: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  heroRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    maxWidth: "780px",
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
  },
  search: { minWidth: "280px", flex: "1 1 280px", maxWidth: "440px" },
  filterRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    alignItems: "center",
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    marginRight: tokens.spacingHorizontalXS,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
    gap: tokens.spacingHorizontalL,
  },
  empty: {
    padding: tokens.spacingVerticalXXL,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  loading: {
    display: "flex",
    justifyContent: "center",
    padding: tokens.spacingVerticalXXL,
  },
  error: {
    padding: tokens.spacingVerticalM,
    color: tokens.colorPaletteRedForeground1,
  },
  countLine: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

const SOURCES: { value: string; label: string }[] = [
  { value: "All", label: "All sources" },
  { value: "microsoft_official", label: "MS Official" },
  { value: "community", label: "Community" },
  { value: "custom", label: "Custom" },
];

interface RefArchPanelProps {
  onContinueIn?: (mode: Mode, seed: string) => void;
}

function seedFromArch(arch: ReferenceArch): string {
  const parts: string[] = [];
  parts.push(`Use the **${arch.title}** reference architecture as the starting point.`);
  const summary = arch.summary ?? arch.description;
  if (summary) parts.push(summary);
  const services = arch.services ?? [];
  if (services.length > 0) parts.push(`Key services: ${services.join(", ")}.`);
  const patterns = arch.patterns ?? [];
  if (patterns.length > 0) parts.push(`Patterns: ${patterns.join(", ")}.`);
  if (arch.learn_url) parts.push(`Reference: ${arch.learn_url}`);
  parts.push("Customise this architecture for the workload described above; keep the WAF posture in mind.");
  return parts.join("\n\n");
}

export default function RefArchPanel({ onContinueIn }: RefArchPanelProps) {
  const styles = useStyles();
  const {
    visible,
    allTags,
    allCategories,
    title,
    subtitle,
    loading,
    error,
    search,
    setSearch,
    activeTag,
    setActiveTag,
    activeCategory,
    setActiveCategory,
    activeSource,
    setActiveSource,
    refresh,
    create,
    update,
    remove,
  } = useRefArch();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ReferenceArch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReferenceArch | null>(null);

  const topTags = useMemo(() => allTags.slice(0, 20), [allTags]);

  function openAdd() {
    setEditTarget(null);
    setFormOpen(true);
  }

  function openEdit(a: ReferenceArch) {
    setEditTarget(a);
    setFormOpen(true);
  }

  async function handleSubmit(body: Parameters<typeof create>[0]) {
    if (editTarget) {
      await update(editTarget.id, body);
    } else {
      await create(body);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await remove(deleteTarget.id);
    setDeleteTarget(null);
  }

  function handleUseAsStarting(arch: ReferenceArch) {
    if (!onContinueIn) return;
    const target: Mode = import.meta.env.VITE_UNIFIED_AGENTS === "true" ? "architect" : "architecture";
    onContinueIn(target, seedFromArch(arch));
  }

  return (
    <div className={styles.root}>
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
            <Button appearance="primary" icon={<AddRegular />} onClick={openAdd}>
              Add architecture
            </Button>
          </div>
        </div>
        {subtitle && <Text className={styles.subtitle}>{subtitle}</Text>}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchBox
            placeholder="Search by title, summary, tag, or service"
            value={search}
            onChange={(_, d) => setSearch(d.value)}
          />
        </div>
      </div>

      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>Source:</span>
        {SOURCES.map((s) => (
          <Button
            key={s.value}
            size="small"
            appearance={activeSource === s.value ? "primary" : "outline"}
            onClick={() => setActiveSource(s.value)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {allCategories.length > 0 && (
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Category:</span>
          <Button
            size="small"
            appearance={activeCategory === "All" ? "primary" : "outline"}
            onClick={() => setActiveCategory("All")}
          >
            All
          </Button>
          {allCategories.map((cat) => (
            <Button
              key={cat}
              size="small"
              appearance={activeCategory === cat ? "primary" : "outline"}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      )}

      {topTags.length > 0 && (
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Tag:</span>
          <Button
            size="small"
            appearance={activeTag === "All" ? "primary" : "outline"}
            onClick={() => setActiveTag("All")}
          >
            All
          </Button>
          {topTags.map((tag) => (
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
      )}

      {error && <div className={styles.error}>{error}</div>}

      {!loading && (
        <div className={styles.countLine}>
          {visible.length} architecture{visible.length === 1 ? "" : "s"}
        </div>
      )}

      {loading ? (
        <div className={styles.loading}><Spinner label="Loading reference architectures…" /></div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          <Text>No reference architectures match the current filters. Try clearing them or adding a custom entry.</Text>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((a) => (
            <RefArchCard
              key={a.id}
              arch={a}
              onEdit={openEdit}
              onDelete={(arch) => setDeleteTarget(arch)}
              onUseAsStarting={onContinueIn ? handleUseAsStarting : undefined}
            />
          ))}
        </div>
      )}

      <RefArchFormDialog
        open={formOpen}
        initial={editTarget}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(_, data) => { if (!data.open) setDeleteTarget(null); }}
      >
        <DialogSurface>
          <DialogTitle>Delete reference architecture?</DialogTitle>
          <DialogBody>
            <Text>
              This will <strong>permanently</strong> remove "{deleteTarget?.title}" from the library. This action cannot be undone.
            </Text>
          </DialogBody>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setDeleteTarget(null)} autoFocus>
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={confirmDelete}
              style={{ backgroundColor: tokens.colorPaletteRedBackground3, borderColor: tokens.colorPaletteRedBorder2 }}
            >
              Delete permanently
            </Button>
          </DialogActions>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
