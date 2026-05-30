"""
Generate draw.io XML diagrams with local Azure SVG icons from icons/azure.xml.
"""

import xml.etree.ElementTree as ET
from collections import defaultdict

from services.icon_service import get_icon_style

NODE_W, NODE_H = 60, 60
X_GAP = 200      # center-to-center horizontal spacing
Y_GAP = 220      # center-to-center vertical spacing
Y_START = 120    # y of first tier row center
MAX_PER_ROW = 6  # nodes per tier before wrapping to a sub-row


def _assign_positions(components: list[dict], connections: list[dict]) -> None:
    """
    Assign x/y to components that lack explicit coordinates.

    Uses a barycenter heuristic: within each tier, nodes are sorted by the
    average X of their already-placed neighbors so that connections tend to
    run straight rather than crossing each other.  When a tier has more than
    MAX_PER_ROW nodes it is split into sub-rows to keep the diagram readable.
    """
    needs_layout = [c for c in components if "x" not in c or "y" not in c]
    if not needs_layout:
        return

    tiers: dict[int, list[dict]] = defaultdict(list)
    for comp in needs_layout:
        tiers[int(comp.get("tier", 2))].append(comp)

    # Bidirectional adjacency map
    adj: dict[str, set[str]] = defaultdict(set)
    for conn in connections:
        adj[conn["from"]].add(conn["to"])
        adj[conn["to"]].add(conn["from"])

    # Max nodes in any single row (capped at MAX_PER_ROW) drives page width
    max_in_row = max((min(len(row), MAX_PER_ROW) for row in tiers.values()), default=1)
    page_width = max(1169, max_in_row * X_GAP + 240)

    placed_x: dict[str, float] = {}  # comp id -> assigned center x

    row_y = Y_START
    for tier_idx in sorted(tiers):
        row = tiers[tier_idx]

        # Barycenter sort: order nodes by the mean X of already-placed neighbours.
        # Nodes with no placed neighbours get a stable default that spreads them evenly.
        default_x = float(page_width) / 2

        def _bary(comp: dict) -> float:
            xs = [placed_x[nb] for nb in adj[comp["id"]] if nb in placed_x]
            return sum(xs) / len(xs) if xs else default_x

        row.sort(key=_bary)

        # Split into sub-rows to avoid very wide single rows
        sub_rows = [row[i : i + MAX_PER_ROW] for i in range(0, len(row), MAX_PER_ROW)]
        for sub_row in sub_rows:
            total_span = (len(sub_row) - 1) * X_GAP
            x_start = max(80, (page_width - total_span) // 2)
            for j, comp in enumerate(sub_row):
                cx = x_start + j * X_GAP
                comp["x"] = cx - NODE_W // 2
                comp["y"] = row_y - NODE_H // 2
                placed_x[comp["id"]] = float(cx)
            row_y += Y_GAP


def _edge_style(src_comp: dict | None, tgt_comp: dict | None) -> str:
    """
    Choose entry/exit connector points based on the relative positions of the
    two nodes.  Routing out of the bottom and into the top (for downward
    connections) keeps hierarchical architecture diagrams free of crossings.
    Lateral and upward connections get matching horizontal or inverse vertical
    exits so the orthogonal router never has to loop around.
    """
    base = "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;"

    if not src_comp or not tgt_comp:
        return base

    src_cx = src_comp.get("x", 0) + NODE_W / 2
    src_cy = src_comp.get("y", 0) + NODE_H / 2
    tgt_cx = tgt_comp.get("x", 0) + NODE_W / 2
    tgt_cy = tgt_comp.get("y", 0) + NODE_H / 2

    dy = tgt_cy - src_cy
    dx = tgt_cx - src_cx

    if abs(dy) >= abs(dx):              # primarily vertical
        if dy >= 0:                     # downward — standard flow direction
            ports = "exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;"
        else:                           # upward (e.g. monitoring back-channel)
            ports = "exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=0.5;entryY=1;entryDx=0;entryDy=0;"
    else:                               # primarily horizontal (same-tier)
        if dx >= 0:                     # rightward
            ports = "exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;"
        else:                           # leftward
            ports = "exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;"

    return base + ports


def generate_diagram(
    components: list[dict],
    connections: list[dict],
    title: str = "Azure Architecture",
) -> str:
    """Build a draw.io XML string from a component/connection list."""
    _assign_positions(components, connections)

    # Canvas: fit content with generous padding
    xs = [c.get("x", 0) for c in components]
    ys = [c.get("y", 0) for c in components]
    page_width = max(1169, max(xs, default=0) + NODE_W + 240)
    page_height = max(827, max(ys, default=0) + NODE_H + 200)

    mxfile = ET.Element("mxfile", host="azure-architect-ai")
    diagram = ET.SubElement(mxfile, "diagram", id="arch", name=title)
    model = ET.SubElement(
        diagram, "mxGraphModel",
        dx="1422", dy="762", grid="1", gridSize="10",
        connect="1", arrows="1", fold="1", page="1", pageScale="1",
        pageWidth=str(page_width), pageHeight=str(page_height),
        math="0", shadow="0",
    )
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", id="0")
    ET.SubElement(root, "mxCell", id="1", parent="0")

    # Index components by id for O(1) lookup in edge routing
    comp_by_id: dict[str, dict] = {c["id"]: c for c in components}

    node_ids: dict[str, str] = {}
    for comp in components:
        cell_id = f"node_{comp['id']}"
        node_ids[comp["id"]] = cell_id
        style = get_icon_style(comp.get("shape", comp["id"]))
        cell = ET.SubElement(
            root, "mxCell",
            id=cell_id,
            value=comp["label"],
            style=style,
            vertex="1",
            parent="1",
        )
        ET.SubElement(
            cell, "mxGeometry",
            x=str(comp.get("x", 0)), y=str(comp.get("y", 0)),
            width=str(NODE_W), height=str(NODE_H),
            **{"as": "geometry"},
        )

    for i, conn in enumerate(connections):
        src_id, tgt_id = conn["from"], conn["to"]
        src_cell = node_ids.get(src_id, "")
        tgt_cell = node_ids.get(tgt_id, "")
        if not (src_cell and tgt_cell):
            continue

        style = _edge_style(comp_by_id.get(src_id), comp_by_id.get(tgt_id))
        cell = ET.SubElement(
            root, "mxCell",
            id=f"edge_{i}",
            value=conn.get("label", ""),
            style=style,
            edge="1",
            source=src_cell,
            target=tgt_cell,
            parent="1",
        )
        ET.SubElement(cell, "mxGeometry", relative="1", **{"as": "geometry"})

    return _serialize(mxfile)


def _serialize(element: ET.Element) -> str:
    ET.indent(element, space="  ")
    return ET.tostring(element, encoding="unicode")
