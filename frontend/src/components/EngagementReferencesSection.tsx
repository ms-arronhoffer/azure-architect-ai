import { useRef, useState } from "react";
import {
  Button,
  Input,
  Field,
  Text,
  Card,
  Spinner,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowDownloadRegular,
  DeleteRegular,
  DocumentRegular,
  LinkRegular,
  AttachRegular,
} from "@fluentui/react-icons";
import { useEngagementReferences } from "../hooks/useEngagementReferences";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  list: { display: "flex", flexDirection: "column", gap: "6px" },
  item: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
  },
  itemLeft: { display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 },
  title: { fontWeight: 600, fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis" },
  meta: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  itemRight: { display: "flex", gap: "4px", flexShrink: 0 },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px",
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
  },
  fileRow: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  fileChip: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    display: "flex",
    gap: "4px",
    alignItems: "center",
  },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: "12px" },
});

function fmtBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

interface Props {
  engagementId: string;
}

export function EngagementReferencesSection({ engagementId }: Props) {
  const styles = useStyles();
  const { items, loading, error, create, remove, downloadUrl } =
    useEngagementReferences(engagementId);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  function reset() {
    setTitle("");
    setUrl("");
    setFile(null);
    setLocalError(null);
    setAdding(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function pickFile(f: File | null) {
    if (f && f.size > MAX_FILE_BYTES) {
      setLocalError("File exceeds 5 MB limit");
      setFile(null);
      return;
    }
    setLocalError(null);
    setFile(f);
  }

  async function save() {
    if (!title.trim()) {
      setLocalError("Title is required");
      return;
    }
    if (!url.trim() && !file) {
      setLocalError("Provide a URL, a file, or both");
      return;
    }
    setBusy(true);
    try {
      await create({ title: title.trim(), url: url.trim() || undefined, file });
      reset();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this reference?")) return;
    try {
      await remove(id);
    } catch {
      // surfaced via hook error
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text weight="semibold">References</Text>
        {!adding && (
          <Button size="small" icon={<AddRegular />} onClick={() => setAdding(true)}>
            Add
          </Button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <Spinner size="tiny" label="Loading…" />
      ) : (
        <div className={styles.list}>
          {items.length === 0 && !adding && (
            <Text style={{ fontSize: "12px", color: tokens.colorNeutralForeground3 }}>
              No references yet. Add CSA workbooks, process guides, or other links.
            </Text>
          )}
          {items.map((r) => (
            <Card key={r.id} className={styles.item}>
              <div className={styles.itemLeft}>
                <div className={styles.title}>{r.title}</div>
                <div className={styles.meta}>
                  {r.url && (
                    <span className={styles.fileChip}>
                      <LinkRegular fontSize={12} />
                      <a href={r.url} target="_blank" rel="noreferrer">link</a>
                    </span>
                  )}
                  {r.has_file && r.file_name && (
                    <span className={styles.fileChip}>
                      <DocumentRegular fontSize={12} />
                      {r.file_name}
                      {r.file_size_bytes ? ` (${fmtBytes(r.file_size_bytes)})` : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.itemRight}>
                {r.has_file && (
                  <Tooltip content="Download file" relationship="label">
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<ArrowDownloadRegular />}
                      as="a"
                      href={downloadUrl(r.id)}
                    />
                  </Tooltip>
                )}
                <Tooltip content="Delete" relationship="label">
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<DeleteRegular />}
                    onClick={() => handleDelete(r.id)}
                  />
                </Tooltip>
              </div>
            </Card>
          ))}
        </div>
      )}

      {adding && (
        <div className={styles.form}>
          <Field label="Title" required>
            <Input value={title} onChange={(_, d) => setTitle(d.value)} placeholder="CSA 101 Workbook" />
          </Field>
          <Field label="URL">
            <Input value={url} onChange={(_, d) => setUrl(d.value)} placeholder="https://…" />
          </Field>
          <div className={styles.fileRow}>
            <input
              ref={fileInput}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <Button
              size="small"
              icon={<AttachRegular />}
              onClick={() => fileInput.current?.click()}
            >
              {file ? "Change file" : "Attach file"}
            </Button>
            {file && (
              <span className={styles.fileChip}>
                <DocumentRegular fontSize={12} />
                {file.name} ({fmtBytes(file.size)})
              </span>
            )}
            <Text style={{ fontSize: "11px", color: tokens.colorNeutralForeground3 }}>
              Max 5 MB
            </Text>
          </div>
          {localError && <div className={styles.error}>{localError}</div>}
          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
            <Button appearance="subtle" disabled={busy} onClick={reset}>
              Cancel
            </Button>
            <Button appearance="primary" disabled={busy} onClick={save}>
              Save reference
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
