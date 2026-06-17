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
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { Demo } from "../types";
import type { DemoInput } from "../hooks/useDemos";

const useStyles = makeStyles({
  surface: {
    width: "min(680px, 92vw)",
    padding: tokens.spacingVerticalL,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalS,
  },
});

interface DemoFormDialogProps {
  open: boolean;
  initial?: Demo | null;
  onClose: () => void;
  onSubmit: (body: DemoInput) => Promise<void>;
}

const EMPTY: DemoInput = {
  title: "",
  description: "",
  tags: [],
  video_url: null,
  repo_url: null,
  live_url: null,
  thumbnail_url: null,
  featured: false,
};

function demoToInput(d: Demo): DemoInput {
  return {
    title: d.title,
    description: d.description,
    tags: d.tags,
    video_url: d.video_url,
    repo_url: d.repo_url,
    live_url: d.live_url,
    thumbnail_url: d.thumbnail_url,
    featured: d.featured,
  };
}

export function DemoFormDialog({ open, initial, onClose, onSubmit }: DemoFormDialogProps) {
  const styles = useStyles();
  const [form, setForm] = useState<DemoInput>(EMPTY);
  const [tagsText, setTagsText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const next = initial ? demoToInput(initial) : EMPTY;
      setForm(next);
      setTagsText(next.tags.join(", "));
    }
  }, [open, initial]);

  function update<K extends keyof DemoInput>(key: K, value: DemoInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.title.trim()) return;
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setSubmitting(true);
    try {
      await onSubmit({ ...form, tags });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
      <DialogSurface className={styles.surface}>
        <DialogTitle>{initial ? "Edit demo" : "Add demo"}</DialogTitle>
        <DialogBody>
          <div className={styles.body}>
            <Field label="Title" required>
              <Input
                value={form.title}
                onChange={(_, d) => update("title", d.value)}
                placeholder="Short, descriptive name"
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={4}
                value={form.description}
                onChange={(_, d) => update("description", d.value)}
                placeholder="What does this demo show? Key Azure services, scenario, audience."
              />
            </Field>
            <Field label="Tags (comma-separated)" hint="e.g. Azure OpenAI, Streaming, Bicep">
              <Input
                value={tagsText}
                onChange={(_, d) => setTagsText(d.value)}
                placeholder="Azure OpenAI, AI Search"
              />
            </Field>
            <Field label="Video URL" hint="YouTube, Vimeo, or direct .mp4/.webm">
              <Input
                value={form.video_url ?? ""}
                onChange={(_, d) => update("video_url", d.value || null)}
                placeholder="https://youtu.be/..."
              />
            </Field>
            <Field label="Repository URL">
              <Input
                value={form.repo_url ?? ""}
                onChange={(_, d) => update("repo_url", d.value || null)}
                placeholder="https://github.com/..."
              />
            </Field>
            <Field label="Live Demo URL" hint="Hosted/deployed app users can interact with">
              <Input
                value={form.live_url ?? ""}
                onChange={(_, d) => update("live_url", d.value || null)}
                placeholder="https://demo.example.com"
              />
            </Field>
            <Field label="Thumbnail URL" hint="Optional — overrides auto-generated YouTube thumbnail">
              <Input
                value={form.thumbnail_url ?? ""}
                onChange={(_, d) => update("thumbnail_url", d.value || null)}
                placeholder="https://..."
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
          <Button appearance="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            onClick={handleSubmit}
            disabled={submitting || !form.title.trim()}
          >
            {initial ? "Save changes" : "Add demo"}
          </Button>
        </DialogActions>
      </DialogSurface>
    </Dialog>
  );
}
