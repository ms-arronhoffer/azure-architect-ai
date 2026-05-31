import JSZip from "jszip";

/** Download a single text file to the user's machine. */
export function downloadTextFile(name: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Bundle a {name: content} map into a single .zip download. */
export async function downloadFilesAsZip(
  zipName: string,
  files: Record<string, string>
): Promise<void> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = zipName.toLowerCase().endsWith(".zip") ? zipName : `${zipName}.zip`;
  a.download = slug;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Guess a syntax-highlight language hint from a filename for <code> display. */
export function languageFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tf") || lower.endsWith(".tfvars")) return "hcl";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".bicep") || lower.endsWith(".bicepparam")) return "bicep";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".kql")) return "kql";
  return "text";
}
