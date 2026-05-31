import { useRef, useState } from "react";
import JSZip from "jszip";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Select,
  Spinner,
  Badge,
  TabList,
  Tab,
  Tooltip,
} from "@fluentui/react-components";
import {
  CodeRegular,
  SendRegular,
  BranchRegular,
  CheckmarkCircleRegular,
  DocumentRegular,
  ArrowDownloadRegular,
  CopyRegular,
  ChatRegular,
} from "@fluentui/react-icons";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useSSE } from "../hooks/useSSE";
import type { CodeFile, ChatMessage } from "../types";
import { apiPath } from "../config/api";

const LANGUAGES = ["python", "typescript", "csharp", "java", "go", "rust"];
const LANG_LABELS: Record<string, string> = {
  python: "Python",
  typescript: "TypeScript",
  csharp: "C#",
  java: "Java",
  go: "Go",
  rust: "Rust",
};

const useStyles = makeStyles({
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  tabs: {
    padding: "0 20px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  content: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  // Generate tab
  genContent: {
    flex: 1,
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    maxWidth: "720px",
    width: "100%",
    alignSelf: "center",
  },
  label: {
    fontWeight: 600,
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    marginBottom: "4px",
    display: "block",
  },
  textarea: {
    width: "100%",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "10px",
    padding: "12px 14px",
    fontSize: "14px",
    lineHeight: "1.6",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    resize: "vertical",
    outline: "none",
    minHeight: "120px",
    boxSizing: "border-box",
    "&::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  textInput: {
    width: "100%",
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "8px 12px",
    fontSize: "14px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    "&::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  row: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-end",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
  },
  progress: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    background: tokens.colorNeutralBackground3,
    borderRadius: "10px",
    padding: "12px 14px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  progressItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
  },
  summary: {
    background: "rgba(0, 120, 212, 0.08)",
    border: "1px solid rgba(0, 120, 212, 0.25)",
    borderRadius: "10px",
    padding: "12px 14px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "1.55",
  },
  // Files tab
  filesLayout: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  fileList: {
    width: "220px",
    flexShrink: 0,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowY: "auto",
    padding: "8px 0",
    background: tokens.colorNeutralBackground1,
  },
  fileItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    "&:hover": {
      background: tokens.colorNeutralBackground3,
    },
  },
  fileItemActive: {
    background: "rgba(0, 120, 212, 0.10)",
    color: tokens.colorNeutralForeground1,
    fontWeight: 500,
  },
  codeArea: {
    flex: 1,
    overflow: "auto",
    background: "#1e1e1e",
  },
  pushBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 16px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    flexShrink: 0,
  },
  repoInput: {
    flex: 1,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  },
  successBanner: {
    padding: "10px 16px",
    background: "rgba(0, 150, 80, 0.12)",
    borderTop: "1px solid rgba(0, 150, 80, 0.3)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexShrink: 0,
  },
  fileActions: {
    display: "flex",
    gap: "6px",
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: "#1e1e1e",
    flexShrink: 0,
    alignItems: "center",
  },
  fileActionBtn: {
    color: "#ccc",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "4px",
    padding: "3px 10px",
    fontSize: "12px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "5px",
    "&:hover": { background: "rgba(255,255,255,0.15)" },
  },
  tabDot: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: tokens.colorBrandBackground,
    marginLeft: "5px",
    verticalAlign: "middle",
  },
  emptyFiles: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
});

export default function CodegenPanel({ onRefine }: { onRefine?: (context: ChatMessage[]) => void }) {
  const styles = useStyles();
  const { stream, isStreaming, cancel } = useSSE();

  const [tab, setTab] = useState<"generate" | "files">("generate");
  const [language, setLanguage] = useState("python");
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<CodeFile | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [suggestedRepo, setSuggestedRepo] = useState("");
  const [repoName, setRepoName] = useState("");
  const [isPushing, setIsPushing] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");

  const requirementsRef = useRef<HTMLTextAreaElement>(null);
  const frameworkRef = useRef<HTMLInputElement>(null);

  async function handleGenerate() {
    const requirements = requirementsRef.current?.value.trim();
    if (!requirements || isStreaming) return;

    setFiles([]);
    setSelectedFile(null);
    setGeneratedFiles([]);
    setSummary("");
    setSuggestedRepo("");
    setRepoUrl("");

    const collected: CodeFile[] = [];

    await stream(
      "/api/codegen/generate",
      { requirements, language, framework: frameworkRef.current?.value.trim() ?? "" },
      (event) => {
        if (event.type === "file") {
          const f: CodeFile = {
            name: event.name as string,
            content: event.content as string,
            language: (event.language as string) || language,
            description: event.description as string | undefined,
          };
          collected.push(f);
          setGeneratedFiles((prev) => [...prev, f.name]);
          setFiles([...collected]);
        }
        if (event.type === "summary") {
          setSummary(event.summary as string);
          const repo = event.repo_name as string;
          setSuggestedRepo(repo);
          setRepoName(repo);
          setTab("files");
          if (collected.length > 0) setSelectedFile(collected[0]);
        }
      },
    );
  }

  async function handlePush() {
    if (!repoName.trim() || isPushing) return;
    setIsPushing(true);
    try {
      const res = await fetch(apiPath("/api/codegen/push"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_name: repoName.trim(),
          files: files.map((f) => ({ name: f.name, content: f.content })),
          description: suggestedRepo,
          private: true,
        }),
      });
      const data = await res.json();
      if (data.repo_url) setRepoUrl(data.repo_url);
    } catch (e) {
      console.error("Push failed:", e);
    } finally {
      setIsPushing(false);
    }
  }

  async function handleDownloadZip() {
    if (files.length === 0) return;
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.name, f.content));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${repoName || "codegen"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopyFile(content: string) {
    navigator.clipboard.writeText(content).catch(() => undefined);
  }

  function handleDownloadFile(file: CodeFile) {
    const blob = new Blob([file.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleRefine() {
    if (!onRefine || !summary) return;
    const fileList = files.map((f) => `- \`${f.name}\``).join("\n");
    onRefine([{
      id: crypto.randomUUID(),
      role: "assistant",
      content: `**Generated Code Summary**\n\n${summary}\n\n**Files:**\n${fileList}`,
    }]);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.tabs}>
        <TabList
          selectedValue={tab}
          onTabSelect={(_, d) => setTab(d.value as "generate" | "files")}
          size="small"
        >
          <Tab value="generate" icon={<CodeRegular />}>Generate</Tab>
          <Tab value="files" icon={<DocumentRegular />}>
            Files {files.length > 0 && `(${files.length})`}{files.length > 0 && <span className={styles.tabDot} />}
          </Tab>
        </TabList>
      </div>

      <div className={styles.content}>
        {tab === "generate" && (
          <div className={styles.genContent}>
            <div>
              <label className={styles.label}>Requirements</label>
              <textarea
                ref={requirementsRef}
                className={styles.textarea}
                placeholder="Describe what you want to build — e.g. 'A FastAPI REST API with SQLite, CRUD for users, JWT auth, and tests'"
                rows={5}
                disabled={isStreaming}
              />
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Language</label>
                <Select
                  value={language}
                  onChange={(_, d) => setLanguage(d.value)}
                  disabled={isStreaming}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>{LANG_LABELS[l]}</option>
                  ))}
                </Select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Framework (optional)</label>
                <input
                  ref={frameworkRef}
                  type="text"
                  className={styles.textInput}
                  placeholder="e.g. FastAPI, Express, Spring Boot"
                  disabled={isStreaming}
                />
              </div>
            </div>

            <div>
              {isStreaming ? (
                <Button appearance="primary" icon={<Spinner size="tiny" />} onClick={cancel}>
                  Stop
                </Button>
              ) : (
                <Button appearance="primary" icon={<SendRegular />} onClick={handleGenerate}>
                  Generate Code
                </Button>
              )}
            </div>

            {(isStreaming || generatedFiles.length > 0) && (
              <div className={styles.progress}>
                <Text weight="semibold" size={200}>Generated files</Text>
                {generatedFiles.map((name) => (
                  <div key={name} className={styles.progressItem}>
                    <CheckmarkCircleRegular style={{ color: "#0f9" }} />
                    {name}
                  </div>
                ))}
                {isStreaming && (
                  <div className={styles.progressItem}>
                    <Spinner size="tiny" />
                    <span>Generating…</span>
                  </div>
                )}
              </div>
            )}

            {summary && (
              <div>
                <div className={styles.summary}>{summary}</div>
                {onRefine && (
                  <Button appearance="subtle" icon={<ChatRegular />} onClick={handleRefine} style={{ marginTop: "10px" }}>
                    Refine in Chat
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "files" && files.length === 0 && (
          <div className={styles.emptyFiles}>
            <Text style={{ color: tokens.colorNeutralForeground3 }}>
              Generate code first to see files here.
            </Text>
          </div>
        )}

        {tab === "files" && files.length > 0 && (
          <>
            <div className={styles.filesLayout}>
              <div className={styles.fileList}>
                {files.map((f) => (
                  <div
                    key={f.name}
                    className={`${styles.fileItem} ${selectedFile?.name === f.name ? styles.fileItemActive : ""}`}
                    onClick={() => setSelectedFile(f)}
                  >
                    <DocumentRegular style={{ flexShrink: 0, fontSize: "14px" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.codeArea}>
                {selectedFile && (
                  <>
                    <div className={styles.fileActions}>
                      <Text size={100} style={{ color: "#999", flex: 1 }}>{selectedFile.name}</Text>
                      <Tooltip content="Copy to clipboard" relationship="label">
                        <button className={styles.fileActionBtn} onClick={() => handleCopyFile(selectedFile.content)}>
                          <CopyRegular style={{ fontSize: "13px" }} /> Copy
                        </button>
                      </Tooltip>
                      <Tooltip content="Download file" relationship="label">
                        <button className={styles.fileActionBtn} onClick={() => handleDownloadFile(selectedFile)}>
                          <ArrowDownloadRegular style={{ fontSize: "13px" }} /> Download
                        </button>
                      </Tooltip>
                    </div>
                    <SyntaxHighlighter
                      language={selectedFile.language || "text"}
                      style={vscDarkPlus}
                      customStyle={{ margin: 0, minHeight: "100%", fontSize: "13px" }}
                      showLineNumbers
                    >
                      {selectedFile.content}
                    </SyntaxHighlighter>
                  </>
                )}
              </div>
            </div>

            {repoUrl ? (
              <div className={styles.successBanner}>
                <CheckmarkCircleRegular style={{ color: "#0c0", fontSize: "18px" }} />
                <Text size={200}>
                  Pushed to GitHub:{" "}
                  <a href={repoUrl} target="_blank" rel="noreferrer" style={{ color: "#50C2FF" }}>
                    {repoUrl}
                  </a>
                </Text>
              </div>
            ) : (
              <div className={styles.pushBar}>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowDownloadRegular />}
                  onClick={handleDownloadZip}
                  title="Download all files as ZIP"
                >
                  Download ZIP
                </Button>
                <input
                  type="text"
                  className={styles.repoInput}
                  placeholder="Repository name (e.g. my-fastapi-app)"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                />
                <Badge appearance="outline" color="informative" size="small">Private</Badge>
                <Button
                  appearance="primary"
                  size="small"
                  icon={isPushing ? <Spinner size="tiny" /> : <BranchRegular />}
                  onClick={handlePush}
                  disabled={isPushing || !repoName.trim()}
                >
                  {isPushing ? "Pushing…" : "Push to GitHub"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
