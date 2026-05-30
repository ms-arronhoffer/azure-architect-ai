import JSZip from "jszip";
import type { BootstrapOutputs } from "../types";

export async function downloadBootstrapZip(name: string, outputs: BootstrapOutputs): Promise<void> {
  const zip = new JSZip();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bootstrap";

  if (outputs.bicepCode) zip.file("main.bicep", outputs.bicepCode);
  if (outputs.paramFile) zip.file("main.bicepparam", outputs.paramFile);
  if (outputs.runbookMarkdown) zip.file("runbook.md", outputs.runbookMarkdown);
  if (outputs.explanation) zip.file("README.md", outputs.explanation);
  if (outputs.costSummary) zip.file("cost-estimate.md", outputs.costSummary);

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}-azure-bootstrap.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
