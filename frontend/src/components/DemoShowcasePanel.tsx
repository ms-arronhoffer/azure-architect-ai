import { useState } from "react";
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
import { useDemos } from "../hooks/useDemos";
import type { Demo, Mode, DemoBuilderSeed } from "../types";
import { DemoCard } from "./DemoCard";
import { DemoFormDialog } from "./DemoFormDialog";

// Recognizable Azure service names we can opportunistically lift out of a demo's
// tags or description so the Demo Builder lands prefilled with a sensible stack.
const KNOWN_AZURE_SERVICES = [
  "Azure OpenAI",
  "App Service",
  "Azure Functions",
  "Container Apps",
  "Azure Kubernetes Service",
  "AKS",
  "Cosmos DB",
  "Azure SQL",
  "Azure Storage",
  "Blob Storage",
  "Azure AI Search",
  "Cognitive Search",
  "Service Bus",
  "Event Hubs",
  "Event Grid",
  "API Management",
  "Key Vault",
  "Azure Monitor",
  "Application Insights",
  "Azure Cache for Redis",
  "Azure Front Door",
  "Azure Databricks",
  "Azure Data Factory",
  "Microsoft Fabric",
  "Logic Apps",
  "Azure Container Registry",
  "Azure Virtual Machines",
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "azure-demo";
}

function extractAzureServices(demo: Demo): string[] {
  const haystack = `${demo.title} ${demo.description} ${demo.tags.join(" ")}`.toLowerCase();
  const found: string[] = [];
  for (const svc of KNOWN_AZURE_SERVICES) {
    if (haystack.includes(svc.toLowerCase()) && !found.includes(svc)) {
      found.push(svc);
    }
  }
  return found;
}

/** Map a showcase Demo into editable Demo Builder defaults. Demos are
 * "starting points" — every field is a best-effort suggestion the user
 * refines before running the build pipeline. */
function seedFromDemo(demo: Demo): DemoBuilderSeed {
  return {
    demo_slug: slugify(demo.title),
    demo_title: demo.title,
    description: demo.description,
    key_features: demo.tags.slice(0, 6),
    azure_services: extractAzureServices(demo),
  };
}

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
  tagRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
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
});

interface DemoShowcasePanelProps {
  onContinueIn?: (mode: Mode, seed: { demoSeed: DemoBuilderSeed }) => void;
}

export default function DemoShowcasePanel({ onContinueIn }: DemoShowcasePanelProps) {
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
    create,
    update,
    remove,
  } = useDemos();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Demo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Demo | null>(null);

  function openAdd() {
    setEditTarget(null);
    setFormOpen(true);
  }

  function openEdit(d: Demo) {
    setEditTarget(d);
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

  function handleUseAsStarting(demo: Demo) {
    if (!onContinueIn) return;
    onContinueIn("demo-build", { demoSeed: seedFromDemo(demo) });
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
              Add demo
            </Button>
          </div>
        </div>
        {subtitle && <Text className={styles.subtitle}>{subtitle}</Text>}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchBox
            placeholder="Search demos by title, description, or tag"
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
        <div className={styles.loading}><Spinner label="Loading demos…" /></div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          <Text>No demos match the current filter. Try clearing the search or adding a new demo.</Text>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((d) => (
            <DemoCard
              key={d.id}
              demo={d}
              onEdit={openEdit}
              onDelete={(demo) => setDeleteTarget(demo)}
              onUseAsStarting={onContinueIn ? handleUseAsStarting : undefined}
            />
          ))}
        </div>
      )}

      <DemoFormDialog
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
          <DialogTitle>Are you sure you want to delete this demo?</DialogTitle>
          <DialogBody>
            <Text>
              This will <strong>permanently</strong> remove "{deleteTarget?.title}" from the catalog. This action cannot be undone.
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
