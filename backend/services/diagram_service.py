"""
Generate draw.io XML diagrams with local Azure SVG icons from icons/azure.xml.
"""

import xml.etree.ElementTree as ET
from collections import defaultdict

from services.icon_service import get_icon_style

NODE_W, NODE_H = 60, 60
X_GAP = 260      # center-to-center horizontal spacing (was 200 — labels overlapped)
Y_GAP = 300      # center-to-center vertical spacing (was 220 — needed for label + edge channel)
Y_START = 140    # y of first tier row center
MAX_PER_ROW = 8  # nodes per tier before wrapping (was 6 — prefer wider over taller)
JETTY = 28       # explicit orthogonal jetty in px so parallel edges separate visibly


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


def _edge_style(
    src_comp: dict | None,
    tgt_comp: dict | None,
    src_port: float = 0.5,
    tgt_port: float = 0.5,
) -> str:
    """
    Choose entry/exit connector points based on the relative positions of the
    two nodes.  Routing out of the bottom and into the top (for downward
    connections) keeps hierarchical architecture diagrams free of crossings.
    Lateral and upward connections get matching horizontal or inverse vertical
    exits so the orthogonal router never has to loop around.

    `src_port` / `tgt_port` slide the connector along the chosen side
    (0.0..1.0) so multiple edges sharing the same node fan out instead of
    stacking on a single midpoint pixel.
    """
    base = f"edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize={JETTY};"

    if not src_comp or not tgt_comp:
        return base

    src_cx = src_comp.get("x", 0) + NODE_W / 2
    src_cy = src_comp.get("y", 0) + NODE_H / 2
    tgt_cx = tgt_comp.get("x", 0) + NODE_W / 2
    tgt_cy = tgt_comp.get("y", 0) + NODE_H / 2

    dy = tgt_cy - src_cy
    dx = tgt_cx - src_cx
    s, t = f"{src_port:.3f}", f"{tgt_port:.3f}"

    if abs(dy) >= abs(dx):              # primarily vertical
        if dy >= 0:                     # downward — standard flow direction
            ports = f"exitX={s};exitY=1;exitDx=0;exitDy=0;entryX={t};entryY=0;entryDx=0;entryDy=0;"
        else:                           # upward (e.g. monitoring back-channel)
            ports = f"exitX={s};exitY=0;exitDx=0;exitDy=0;entryX={t};entryY=1;entryDx=0;entryDy=0;"
    else:                               # primarily horizontal (same-tier)
        if dx >= 0:                     # rightward
            ports = f"exitX=1;exitY={s};exitDx=0;exitDy=0;entryX=0;entryY={t};entryDx=0;entryDy=0;"
        else:                           # leftward
            ports = f"exitX=0;exitY={s};exitDx=0;exitDy=0;entryX=1;entryY={t};entryDx=0;entryDy=0;"

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

    # Pre-compute per-side edge counts so we can fan out ports.
    # Side key = ("out"|"in", node_id, "v"|"h", direction_sign) where direction_sign
    # is +1 (down/right) or -1 (up/left). All edges that exit the same side of the
    # same node share a slot pool, evenly distributed across that side.
    def _side_key(src: dict, tgt: dict, end: str) -> tuple:
        dy = (tgt.get("y", 0) + NODE_H / 2) - (src.get("y", 0) + NODE_H / 2)
        dx = (tgt.get("x", 0) + NODE_W / 2) - (src.get("x", 0) + NODE_W / 2)
        axis = "v" if abs(dy) >= abs(dx) else "h"
        sign = 1 if (dy >= 0 if axis == "v" else dx >= 0) else -1
        node_id = src["id"] if end == "out" else tgt["id"]
        return (end, node_id, axis, sign)

    side_counts: dict[tuple, int] = defaultdict(int)
    side_slots: list[tuple[tuple, int, tuple, int]] = []  # per-edge: (out_key, out_idx, in_key, in_idx)
    for conn in connections:
        s_c = comp_by_id.get(conn["from"])
        t_c = comp_by_id.get(conn["to"])
        if not (s_c and t_c):
            side_slots.append(((), 0, (), 0))
            continue
        ok = _side_key(s_c, t_c, "out")
        ik = _side_key(s_c, t_c, "in")
        oi = side_counts[ok]; side_counts[ok] += 1
        ii = side_counts[ik]; side_counts[ik] += 1
        side_slots.append((ok, oi, ik, ii))

    for i, conn in enumerate(connections):
        src_id, tgt_id = conn["from"], conn["to"]
        src_cell = node_ids.get(src_id, "")
        tgt_cell = node_ids.get(tgt_id, "")
        if not (src_cell and tgt_cell):
            continue

        ok, oi, ik, ii = side_slots[i]
        src_port = (oi + 1) / (side_counts[ok] + 1) if ok else 0.5
        tgt_port = (ii + 1) / (side_counts[ik] + 1) if ik else 0.5

        style = _edge_style(comp_by_id.get(src_id), comp_by_id.get(tgt_id), src_port, tgt_port)
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


def generate_gantt_xml(phases: list[dict], total_weeks: int, critical_path: list[str] | None = None) -> str:
    """
    Generate a draw.io XML Gantt chart from project phase definitions.

    Layout:
    - Row 0: week header (week numbers)
    - Rows 1..N: one row per phase
    - Milestone phases rendered as diamonds; critical-path phases in red
    - Dependency arrows connect phase end → dependent phase start
    """
    critical_path = set(critical_path or [])
    LABEL_W = 150     # left column width for phase labels
    WEEK_W = 40       # width per week
    ROW_H = 38        # row height
    HEADER_H = 30     # header row height
    MARGIN = 20

    total_w = LABEL_W + total_weeks * WEEK_W + MARGIN * 2
    total_h = HEADER_H + len(phases) * ROW_H + MARGIN * 2

    mxfile = ET.Element("mxfile", host="azure-architect-ai")
    diagram = ET.SubElement(mxfile, "diagram", name="Project Timeline")
    model = ET.SubElement(
        diagram, "mxGraphModel",
        dx="1422", dy="762", grid="1", gridSize="10",
        guides="1", tooltips="1", connect="1", arrows="1",
        fold="1", page="1", pageScale="1",
        pageWidth=str(max(1169, total_w + 40)),
        pageHeight=str(max(827, total_h + 80)),
        math="0", shadow="0",
    )
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", id="0")
    ET.SubElement(root, "mxCell", id="1", parent="0")

    cell_id = 2

    # ── Header row: week numbers ──────────────────────────────────────────────
    for w in range(1, total_weeks + 1):
        x = MARGIN + LABEL_W + (w - 1) * WEEK_W
        cell = ET.SubElement(
            root, "mxCell",
            id=str(cell_id),
            value=f"W{w}",
            style="text;html=1;strokeColor=none;fillColor=#dae8fc;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=9;fontStyle=1;",
            vertex="1",
            parent="1",
        )
        ET.SubElement(cell, "mxGeometry",
                      x=str(x), y=str(MARGIN),
                      width=str(WEEK_W), height=str(HEADER_H),
                      **{"as": "geometry"})
        cell_id += 1

    # Track cell IDs by phase id for dependency arrows
    phase_cell_ids: dict[str, str] = {}

    # ── Phase rows ────────────────────────────────────────────────────────────
    for row_idx, phase in enumerate(phases):
        y = MARGIN + HEADER_H + row_idx * ROW_H
        phase_id = phase.get("id", f"p{row_idx}")
        name = phase.get("name", "")
        start = max(1, phase.get("start_week", 1))
        duration = max(0, phase.get("duration_weeks", 1))
        owner = phase.get("owner", "")
        is_milestone = phase.get("is_milestone", False) or duration == 0
        on_critical = phase_id in critical_path

        # Label cell
        label_cell = ET.SubElement(
            root, "mxCell",
            id=str(cell_id),
            value=f'<b>{name}</b>' + (f'<br/><font style="font-size:8px">{owner}</font>' if owner else ""),
            style="text;html=1;strokeColor=#d6b656;fillColor=#fff2cc;align=left;verticalAlign=middle;spacingLeft=4;whiteSpace=wrap;overflow=hidden;rounded=0;fontSize=10;",
            vertex="1",
            parent="1",
        )
        ET.SubElement(label_cell, "mxGeometry",
                      x=str(MARGIN), y=str(y),
                      width=str(LABEL_W), height=str(ROW_H),
                      **{"as": "geometry"})
        cell_id += 1

        # Bar or milestone diamond
        bar_x = MARGIN + LABEL_W + (start - 1) * WEEK_W
        bar_w = max(WEEK_W, duration * WEEK_W)
        bar_y = y + 4
        bar_h = ROW_H - 8

        if is_milestone:
            fill = "#ffe6cc"
            stroke = "#d6b656"
            style = f"rhombus;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontSize=9;"
            bar_w = bar_h  # square-ish diamond
        elif on_critical:
            fill = "#f8cecc"
            stroke = "#b85450"
            style = f"rounded=0;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontSize=9;"
        else:
            fill = "#dae8fc"
            stroke = "#6c8ebf"
            style = f"rounded=0;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontSize=9;"

        bar_cell = ET.SubElement(
            root, "mxCell",
            id=str(cell_id),
            value="",
            style=style,
            vertex="1",
            parent="1",
        )
        ET.SubElement(bar_cell, "mxGeometry",
                      x=str(bar_x), y=str(bar_y),
                      width=str(bar_w), height=str(bar_h),
                      **{"as": "geometry"})
        phase_cell_ids[phase_id] = str(cell_id)
        cell_id += 1

    # ── Dependency arrows ──────────────────────────────────────────────────────
    for phase in phases:
        phase_id = phase.get("id", "")
        deps = phase.get("dependencies", [])
        if not deps or phase_id not in phase_cell_ids:
            continue
        for dep_id in deps:
            if dep_id not in phase_cell_ids:
                continue
            edge = ET.SubElement(
                root, "mxCell",
                id=str(cell_id),
                value="",
                style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;strokeColor=#555555;",
                edge="1",
                source=phase_cell_ids[dep_id],
                target=phase_cell_ids[phase_id],
                parent="1",
            )
            ET.SubElement(edge, "mxGeometry", relative="1", **{"as": "geometry"})
            cell_id += 1

    return _serialize(mxfile)

