import { useEffect, useState } from "react";
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  Button,
  Input,
  Textarea,
  Switch,
  Field,
  Select,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { ReferenceArch } from "../types";
import type { RefArchInput } from "../hooks/useRefArch";

const useStyles = makeStyles({
  surface: {
    width: "min(720px, 92vw)",
    padding: tokens.spacingVerticalL,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalS,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: tokens.spacingHorizontalM,
  },
  wafGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: tokens.spacingHorizontalS,
  },
  banner: {
    padding: tokens.spacingVerticalS,
    background: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
});

interface RefArchFormDialogProps {
  open: boolean;
  initial?: ReferenceArch | null;
  onClose: () => void;
  onSubmit: (body: RefArchInput) => Promise<void>;
}

const EMPTY: RefArchInput = {
  title: "",
  summary: "",
  category: "general",
  tags: [],
  services: [],
  patterns: [],
  waf_score: { reliability: 3, security: 3, cost: 3, operations: 3, performance: 3 },
  estimated_monthly: {},
  complexity: "Medium",
  learn_url: "",
  repo_url: null,
  bicep_avm_module: null,
  diagram_url: null,
  featured: false,
};

const PILLARS = ["reliability", "security", "cost", "operations", "performance"] as const;

function archToInput(a: ReferenceArch): RefArchInput {
  return {
    title: a.title,
    summary: a.summary ?? a.description ?? "",
    category: a.category,
    tags: a.tags ?? [],
    services: a.services ?? [],
    patterns: a.patterns ?? [],
    waf_score: { ...EMPTY.waf_score, ...(a.waf_score ?? {}) },
    estimated_monthly:
      typeof a.estimated_monthly === "object" && a.estimated_monthly !== null
        ? (a.estimated_monthly as Record<string, number | string>)
        : { range_label: String(a.estimated_monthly ?? "") },
    complexity: (a.complexity as "Low" | "Medium" | "High") ?? "Medium",
    learn_url: a.learn_url,
    repo_url: a.repo_url ?? null,
    bicep_avm_module: a.bicep_avm_module ?? null,
    diagram_url: a.diagram_url ?? null,
    featured: a.featured ?? false,
  };
}

function joinList(value: string[]): string {
  return value.join(", ");
}

function parseList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function RefArchFormDialog({ open, initial, onClose, onSubmit }: RefArchFormDialogProps) {
  const styles = useStyles();
  const [form, setForm] = useState<RefArchInput>(EMPTY);
  const [tagsText, setTagsText] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [patternsText, setPatternsText] = useState("");
  const [monthlyText, setMonthlyText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isCurated = !!(initial && initial.source && initial.source !== "custom");

  useEffect(() => {
    if (!open) return;
    const next = initial ? archToInput(initial) : EMPTY;
    setForm(next);
    setTagsText(joinList(next.tags));
    setServicesText(joinList(next.services));
    setPatternsText(joinList(next.patterns));
    const monthly = next.estimated_monthly ?? {};
    const entries = Object.entries(monthly).filter(([k, v]) => k !== "range_label" && typeof v === "number");
    setMonthlyText(entries.map(([k, v]) => `${k}=${v}`).join(", "));
  }, [open, initial]);

  function update<K extends keyof RefArchInput>(key: K, value: RefArchInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateWaf(pillar: string, value: number) {
    setForm((prev) => ({ ...prev, waf_score: { ...prev.waf_score, [pillar]: value } }));
  }

  function parseMonthly(text: string): Record<string, number | string> {
    const out: Record<string, number> = {};
    text.split(",").map((s) => s.trim()).filter(Boolean).forEach((pair) => {
      const eq = pair.indexOf("=");
      if (eq <= 0) return;
      const key = pair.slice(0, eq).trim();
      const numStr = pair.slice(eq + 1).trim();
      const num = Number(numStr);
      if (key && !Number.isNaN(num)) out[key] = num;
    });
    return out;
  }

  async function handleSubmit() {
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      if (isCurated) {
        // Only featured is editable on curated entries.
        await onSubmit({ ...form, featured: form.featured });
      } else {
        const body: RefArchInput = {
          ...form,
          tags: parseList(tagsText),
          services: parseList(servicesText),
          patterns: parseList(patternsText),
          estimated_monthly: parseMonthly(monthlyText),
        };
        await onSubmit(body);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
      <DialogSurface className={styles.surface}>
        <DialogTitle>
          {initial ? (isCurated ? "Curated entry" : "Edit reference architecture") : "Add reference architecture"}
        </DialogTitle>
        <DialogBody>
          <div className={styles.body}>
            {isCurated && (
              <div className={styles.banner}>
                This is a <strong>{initial?.source}</strong> entry — only the <em>Featured</em>{" "}
                flag can be changed. To customise the rest, duplicate it as a new custom entry.
              </div>
            )}
            <Field label="Title" required>
              <Input
                value={form.title}
                onChange={(_, d) => update("title", d.value)}
                disabled={isCurated}
              />
            </Field>
            <Field label="Summary">
              <Textarea
                rows={3}
                value={form.summary}
                onChange={(_, d) => update("summary", d.value)}
                disabled={isCurated}
              />
            </Field>
            <div className={styles.row}>
              <Field label="Category">
                <Input
                  value={form.category}
                  onChange={(_, d) => update("category", d.value)}
                  placeholder="e.g. web, data, ai, networking"
                  disabled={isCurated}
                />
              </Field>
              <Field label="Complexity">
                <Select
                  value={form.complexity}
                  onChange={(_, d) => update("complexity", d.value as "Low" | "Medium" | "High")}
                  disabled={isCurated}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </Select>
              </Field>
            </div>
            <Field label="Tags (comma-separated)">
              <Input value={tagsText} onChange={(_, d) => setTagsText(d.value)} disabled={isCurated} />
            </Field>
            <Field label="Services (comma-separated)">
              <Input value={servicesText} onChange={(_, d) => setServicesText(d.value)} disabled={isCurated} />
            </Field>
            <Field label="Patterns (comma-separated)" hint="e.g. web-app, microservices, event-driven">
              <Input value={patternsText} onChange={(_, d) => setPatternsText(d.value)} disabled={isCurated} />
            </Field>
            <Field
              label="Estimated monthly (region=usd, comma-separated)"
              hint="e.g. eastus=1200, westeurope=1320"
            >
              <Input value={monthlyText} onChange={(_, d) => setMonthlyText(d.value)} disabled={isCurated} />
            </Field>
            <Field label="WAF scores (0–5 per pillar)">
              <div className={styles.wafGrid}>
                {PILLARS.map((pillar) => (
                  <Field key={pillar} label={pillar} size="small">
                    <Input
                      type="number"
                      min={0}
                      max={5}
                      value={String(form.waf_score[pillar] ?? 3)}
                      onChange={(_, d) => updateWaf(pillar, Math.max(0, Math.min(5, Number(d.value) || 0)))}
                      disabled={isCurated}
                    />
                  </Field>
                ))}
              </div>
            </Field>
            <Field label="Learn URL">
              <Input
                value={form.learn_url}
                onChange={(_, d) => update("learn_url", d.value)}
                placeholder="https://learn.microsoft.com/..."
                disabled={isCurated}
              />
            </Field>
            <div className={styles.row}>
              <Field label="Repo URL">
                <Input
                  value={form.repo_url ?? ""}
                  onChange={(_, d) => update("repo_url", d.value || null)}
                  disabled={isCurated}
                />
              </Field>
              <Field label="Bicep AVM module">
                <Input
                  value={form.bicep_avm_module ?? ""}
                  onChange={(_, d) => update("bicep_avm_module", d.value || null)}
                  placeholder="avm/res/web/site"
                  disabled={isCurated}
                />
              </Field>
            </div>
            <Field label="Diagram URL">
              <Input
                value={form.diagram_url ?? ""}
                onChange={(_, d) => update("diagram_url", d.value || null)}
                disabled={isCurated}
              />
            </Field>
            <Field label="Featured">
              <Switch
                checked={form.featured}
                onChange={(_, d) => update("featured", d.checked)}
                label={form.featured ? "Featured — pinned to top" : "Not featured"}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogActions>
          <Button appearance="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            appearance="primary"
            onClick={handleSubmit}
            disabled={submitting || !form.title.trim()}
          >
            {initial ? "Save changes" : "Add architecture"}
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  );
}
