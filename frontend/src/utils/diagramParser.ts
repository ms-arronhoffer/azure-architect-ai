export interface DiagramNode {
  id: string;
  label: string;
  shape: string;
}

export function parseDiagramNodes(xml: string): DiagramNode[] {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const cells = Array.from(doc.querySelectorAll("mxCell"));
    const nodes: DiagramNode[] = [];
    for (const cell of cells) {
      const label = cell.getAttribute("value") ?? "";
      const style = cell.getAttribute("style") ?? "";
      const vertex = cell.getAttribute("vertex");
      if (!vertex || !label.trim()) continue;
      if (style.includes("edgeStyle") || style.includes("curved=1") || !style) continue;
      if (label.toLowerCase() === "internet" || label.toLowerCase() === "users") continue;
      const id = cell.getAttribute("id") ?? crypto.randomUUID();
      const shapeMatch = style.match(/shape=mxgraph\.azure[^;]*/);
      const shape = shapeMatch ? shapeMatch[0] : "azure";
      const cleanLabel = label.replace(/<[^>]+>/g, "").trim();
      if (cleanLabel) nodes.push({ id, label: cleanLabel, shape });
    }
    return nodes;
  } catch {
    return [];
  }
}
