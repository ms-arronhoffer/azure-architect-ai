"""
Generate draw.io XML diagrams with local Azure SVG icons from icons/azure.xml.

Two layout modes:
  - **Flat** (no `group` field on any component) — legacy barycenter-sorted
    tier layout. Unchanged behavior.
  - **Clustered** (any component carries `group`) — within each tier, nodes
    are bucketed by group (external / edge / compute / data / observability)
    and drawn inside a dashed cluster rectangle. Inter-cluster edges either
    (a) share a channel between cluster boundaries with per-edge Y tracks,
    or (b) when ≥HUB_BUNDLE_MIN edges from the same source cluster converge
    on one sink, get bundled through a shared approach trunk near the sink.
"""

import xml.etree.ElementTree as ET
from collections import defaultdict

from services.icon_service import get_icon_style

NODE_W, NODE_H = 60, 60
X_GAP = 260      # center-to-center horizontal spacing (was 200 — labels overlapped)
Y_GAP = 300      # center-to-center vertical spacing (was 220 — needed for label + edge channel)
Y_START = 140    # y of first tier row center
JETTY = 28       # explicit orthogonal jetty in px so parallel edges separate visibly

# ── Cluster layout ────────────────────────────────────────────────────────────
GROUP_ORDER = ["external", "edge", "compute", "data", "observability"]
_GROUP_RANK = {g: i for i, g in enumerate(GROUP_ORDER)}
CLUSTER_COLORS = {
    "external":      "#9aa0a6",
    "edge":          "#1976d2",
    "compute":       "#388e3c",
    "data":          "#f57c00",
    "observability": "#7b1fa2",
}
CLUSTER_LABELS = {
    "external":      "External",
    "edge":          "Edge / Ingress",
    "compute":       "Compute",
    "data":          "Data",
    "observability": "Observability",
}
CLUSTER_PAD_X = 24
CLUSTER_PAD_Y = 36   # extra room at top for the cluster label
CLUSTER_GAP_X = 60   # horizontal space between adjacent cluster boxes

# Hub bundling: when a sink has at least this many inbound edges from a single
# source cluster, route them through a shared trunk near the sink.
HUB_BUNDLE_MIN = 3
HUB_TRUNK_OFFSET = 28


def _has_groups(components: list[dict]) -> bool:
    return any("group" in c for c in components)


def _assign_positions(components: list[dict], connections: list[dict]) -> None:
    """
    Assign x/y to components that lack explicit coordinates.

    Uses a barycenter heuristic: within each tier, nodes are sorted by the
    average X of their already-placed neighbors so that connections tend to
    run straight rather than crossing each other.
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

    # Page width grows to fit the widest tier — no artificial cap.
    max_in_row = max((len(row) for row in tiers.values()), default=1)
    page_width = max(1169, max_in_row * X_GAP + 240)

    placed_x: dict[str, float] = {}  # comp id -> assigned center x

    row_y = Y_START
    for tier_idx in sorted(tiers):
        row = tiers[tier_idx]

        # Barycenter sort: order nodes by the mean X of already-placed neighbours.
        # Nodes with no placed neighbours get a stable default that spreads them evenly.
        default_x = float(page_width) / 2

        def _bary(comp: dict, _default: float = default_x) -> float:
            xs = [placed_x[nb] for nb in adj[comp["id"]] if nb in placed_x]
            return sum(xs) / len(xs) if xs else _default

        row.sort(key=_bary)

        total_span = (len(row) - 1) * X_GAP
        x_start = max(80, (page_width - total_span) // 2)
        for j, comp in enumerate(row):
            cx = x_start + j * X_GAP
            comp["x"] = cx - NODE_W // 2
            comp["y"] = row_y - NODE_H // 2
            placed_x[comp["id"]] = float(cx)
        row_y += Y_GAP


def _assign_positions_clustered(
    components: list[dict], connections: list[dict]
) -> list[dict]:
    """
    Group-aware layered layout. Returns cluster rectangles as a list of dicts:
    `{tier, group, x, y, w, h, members}`. Within each tier, components are
    bucketed by `group` in GROUP_ORDER, barycenter-sorted within bucket, then
    placed left-to-right with CLUSTER_GAP_X between buckets. Components that
    already have explicit x/y are left in place.
    """
    needs_layout = [c for c in components if "x" not in c or "y" not in c]
    if not needs_layout:
        return []

    adj: dict[str, set[str]] = defaultdict(set)
    for conn in connections:
        adj[conn["from"]].add(conn["to"])
        adj[conn["to"]].add(conn["from"])

    tiers: dict[int, list[dict]] = defaultdict(list)
    for comp in needs_layout:
        tiers[int(comp.get("tier", 2))].append(comp)

    placed_x: dict[str, float] = {}
    clusters: list[dict] = []

    row_y = Y_START
    for tier_idx in sorted(tiers):
        row = tiers[tier_idx]
        buckets: dict[str, list[dict]] = defaultdict(list)
        for comp in row:
            buckets[comp.get("group", "compute")].append(comp)
        ordered_groups = sorted(buckets.keys(), key=lambda g: _GROUP_RANK.get(g, 99))

        def _bary(c: dict) -> float:
            xs = [placed_x[n] for n in adj[c["id"]] if n in placed_x]
            return sum(xs) / len(xs) if xs else 0.0

        for g in ordered_groups:
            buckets[g].sort(key=_bary)

        bucket_widths: dict[str, int] = {}
        total_w = 0
        for g in ordered_groups:
            n = len(buckets[g])
            w = n * NODE_W + (n - 1) * (X_GAP - NODE_W) + 2 * CLUSTER_PAD_X
            bucket_widths[g] = w
            total_w += w
        total_w += (len(ordered_groups) - 1) * CLUSTER_GAP_X

        page_width = max(1169, total_w + 240)
        x_cursor = max(80, (page_width - total_w) // 2)

        for g in ordered_groups:
            members = buckets[g]
            cluster_x = x_cursor
            cluster_y = row_y - NODE_H // 2 - CLUSTER_PAD_Y + 6
            cluster_w = bucket_widths[g]
            cluster_h = NODE_H + CLUSTER_PAD_Y + 16

            inner_x = cluster_x + CLUSTER_PAD_X
            for j, comp in enumerate(members):
                comp["x"] = inner_x + j * X_GAP
                comp["y"] = row_y - NODE_H // 2
                placed_x[comp["id"]] = comp["x"] + NODE_W / 2

            clusters.append({
                "tier": tier_idx,
                "group": g,
                "x": cluster_x,
                "y": cluster_y,
                "w": cluster_w,
                "h": cluster_h,
                "members": [c["id"] for c in members],
            })
            x_cursor += cluster_w + CLUSTER_GAP_X
        row_y += Y_GAP

    return clusters


def _compute_edge_waypoints(
    components: list[dict],
    connections: list[dict],
    clusters: list[dict],
) -> dict[tuple[str, str], list[tuple[float, float]]]:
    """
    Two-pass router for inter-cluster edges:

    1. **Hub bundling** — when a sink has ≥HUB_BUNDLE_MIN inbound edges from a
       single source cluster, route each through a shared trunk just outside
       the sink. Per-side ports on the sink then fan the trunk out to distinct
       entry points, producing a clean "many-to-one" approach.
    2. **Channel routing** — remaining inter-cluster edges between the same
       (src_cluster, tgt_cluster) pair get unique Y tracks within the gap
       between cluster boundaries so parallel edges no longer stack into a
       single fat line.

    Intra-cluster edges are left for draw.io's native orthogonal routing.
    """
    if not clusters:
        return {}

    by_id = {c["id"]: c for c in components}
    cluster_by_id: dict[str, dict] = {}
    for cl in clusters:
        for m in cl["members"]:
            cluster_by_id[m] = cl

    inter: list[tuple[dict, dict, dict, dict, dict]] = []
    for conn in connections:
        s = by_id.get(conn["from"])
        t = by_id.get(conn["to"])
        if not (s and t):
            continue
        sc = cluster_by_id.get(s["id"])
        tc = cluster_by_id.get(t["id"])
        if sc is None or tc is None or sc is tc:
            continue
        inter.append((conn, s, t, sc, tc))

    waypoints: dict[tuple[str, str], list[tuple[float, float]]] = {}
    bundled: set[tuple[str, str]] = set()

    # ── Hub bundling per (sink, source_cluster) ────────────────────────────
    hub_groups: dict[tuple[str, int], list] = defaultdict(list)
    for item in inter:
        conn, _, t, sc, _ = item
        hub_groups[(t["id"], id(sc))].append(item)

    for (sink_id, _), items in hub_groups.items():
        if len(items) < HUB_BUNDLE_MIN:
            continue
        sink = by_id[sink_id]
        any_src = items[0][1]
        downward = any_src["y"] < sink["y"]
        trunk_y = (
            sink["y"] - HUB_TRUNK_OFFSET if downward
            else sink["y"] + NODE_H + HUB_TRUNK_OFFSET
        )
        sink_cx = sink["x"] + NODE_W / 2
        for conn, s, _, _, _ in items:
            sx = s["x"] + NODE_W / 2
            waypoints[(conn["from"], conn["to"])] = [(sx, trunk_y), (sink_cx, trunk_y)]
            bundled.add((conn["from"], conn["to"]))

    # ── Channel routing for remaining inter-cluster edges ──────────────────
    pairs: dict[tuple[int, int], list] = defaultdict(list)
    for item in inter:
        conn, _, _, sc, tc = item
        if (conn["from"], conn["to"]) in bundled:
            continue
        pairs[(id(sc), id(tc))].append(item)

    for items in pairs.values():
        if len(items) < 2:
            continue
        items.sort(key=lambda kv: kv[1]["x"])
        n = len(items)
        sample_sc = items[0][3]
        sample_tc = items[0][4]
        s_bottom = sample_sc["y"] + sample_sc["h"]
        t_top = sample_tc["y"]
        if t_top > s_bottom:
            band_top = s_bottom + 12
            band_bot = t_top - 12
        else:
            band_top = t_top + sample_tc["h"] + 12
            band_bot = sample_sc["y"] - 12
        band_h = max(band_bot - band_top, 20)

        for slot, (conn, s, t, _, _) in enumerate(items):
            track_y = (
                (band_top + band_bot) / 2 if n == 1
                else band_top + band_h * (slot / (n - 1))
            )
            sx = s["x"] + NODE_W / 2
            tx = t["x"] + NODE_W / 2
            waypoints[(conn["from"], conn["to"])] = [(sx, track_y), (tx, track_y)]

    return waypoints


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
    use_clusters = _has_groups(components)
    if use_clusters:
        clusters = _assign_positions_clustered(components, connections)
        waypoints = _compute_edge_waypoints(components, connections, clusters)
    else:
        _assign_positions(components, connections)
        clusters = []
        waypoints = {}

    # Canvas: fit content (including cluster rectangles) with generous padding
    xs = [c.get("x", 0) for c in components]
    ys = [c.get("y", 0) for c in components]
    right = max(xs, default=0) + NODE_W
    bottom = max(ys, default=0) + NODE_H
    for cl in clusters:
        right = max(right, cl["x"] + cl["w"])
        bottom = max(bottom, cl["y"] + cl["h"])
    page_width = max(1169, right + 240)
    page_height = max(827, bottom + 200)

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

    # Cluster rectangles must come BEFORE node cells so they render behind
    # them — draw.io z-order follows document order.
    for idx, cl in enumerate(clusters):
        color = CLUSTER_COLORS.get(cl["group"], "#888888")
        label = CLUSTER_LABELS.get(cl["group"], cl["group"].title())
        style = (
            f"rounded=1;whiteSpace=wrap;html=1;"
            f"fillColor=none;strokeColor={color};dashed=1;dashPattern=4 4;"
            f"verticalAlign=top;align=left;fontSize=11;fontColor={color};"
            f"spacingTop=4;spacingLeft=10;strokeWidth=1.5;"
        )
        cell = ET.SubElement(
            root, "mxCell",
            id=f"cluster_{idx}",
            value=label,
            style=style,
            vertex="1",
            parent="1",
        )
        ET.SubElement(
            cell, "mxGeometry",
            x=str(cl["x"]), y=str(cl["y"]),
            width=str(cl["w"]), height=str(cl["h"]),
            **{"as": "geometry"},
        )

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
        oi = side_counts[ok]
        side_counts[ok] += 1
        ii = side_counts[ik]
        side_counts[ik] += 1
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
        geom = ET.SubElement(cell, "mxGeometry", relative="1", **{"as": "geometry"})
        pts = waypoints.get((src_id, tgt_id))
        if pts:
            arr = ET.SubElement(geom, "Array", **{"as": "points"})
            for x, y in pts:
                ET.SubElement(arr, "mxPoint", x=str(int(x)), y=str(int(y)))

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


def generate_network_diagram(topology: dict) -> str:
    """
    Generate a draw.io XML network topology diagram.

    Layout:
    - hub-spoke / vwan: hub VNet centered on top row, spokes spread on row below
    - peered / single-vnet: VNets laid out left-to-right in a single row
    - VNets are swimlane containers; subnets are nested rectangles
    - Hub-spoke peerings rendered as bidirectional edges between hub and each spoke
    - Firewall, DNS design, and NSG rule summary rendered as a footer note
    - Private endpoints annotated on their target subnet
    """
    topology_type = topology.get("topology_type", "single-vnet")
    vnets = topology.get("vnets", []) or []
    nsg_rules = topology.get("nsg_rules", []) or []
    private_endpoints = topology.get("private_endpoints", []) or []
    firewall = topology.get("firewall", "")
    dns_design = topology.get("dns_design", "")

    VNET_W = 320
    VNET_HEADER_H = 30
    SUBNET_H = 44
    SUBNET_PAD_X = 12
    SUBNET_GAP_Y = 8
    SUBNET_TOP_OFFSET = VNET_HEADER_H + 12
    H_GAP = 80
    V_GAP = 110
    MARGIN = 40

    pe_by_subnet: dict[str, list[dict]] = defaultdict(list)
    for pe in private_endpoints:
        pe_by_subnet[pe.get("subnet", "")].append(pe)

    def _vnet_height(v: dict) -> int:
        subnets = v.get("subnets", []) or []
        rows = max(1, len(subnets))
        extra = sum(10 for s in subnets if pe_by_subnet.get(s.get("name", "")))
        return SUBNET_TOP_OFFSET + rows * (SUBNET_H + SUBNET_GAP_Y) + extra + 16

    is_hub_spoke = topology_type in ("hub-spoke", "vwan") and len(vnets) >= 2
    positions: list[tuple[dict, int, int, int, int]] = []

    if is_hub_spoke:
        hub = vnets[0]
        spokes = vnets[1:]
        hub_h = _vnet_height(hub)
        spoke_heights = [_vnet_height(s) for s in spokes]
        max_spoke_h = max(spoke_heights, default=0)
        spokes_total_w = len(spokes) * VNET_W + max(0, len(spokes) - 1) * H_GAP
        canvas_w = max(VNET_W, spokes_total_w) + 2 * MARGIN
        hub_x = (canvas_w - VNET_W) // 2
        hub_y = MARGIN
        positions.append((hub, hub_x, hub_y, VNET_W, hub_h))
        spoke_y = hub_y + hub_h + V_GAP
        spoke_x_start = (canvas_w - spokes_total_w) // 2
        for i, s in enumerate(spokes):
            sx = spoke_x_start + i * (VNET_W + H_GAP)
            positions.append((s, sx, spoke_y, VNET_W, spoke_heights[i]))
        canvas_h = spoke_y + max_spoke_h + MARGIN
    else:
        heights = [_vnet_height(v) for v in vnets] or [200]
        total_w = len(vnets) * VNET_W + max(0, len(vnets) - 1) * H_GAP
        canvas_w = max(VNET_W, total_w) + 2 * MARGIN
        canvas_h = max(heights) + 2 * MARGIN
        for i, v in enumerate(vnets):
            x = MARGIN + i * (VNET_W + H_GAP)
            positions.append((v, x, MARGIN, VNET_W, heights[i]))

    page_w = max(1169, canvas_w + 60)
    page_h = max(827, canvas_h + 200)  # leave room for footer note

    mxfile = ET.Element("mxfile", host="azure-architect-ai")
    diagram = ET.SubElement(mxfile, "diagram", id="network", name="Network Topology")
    model = ET.SubElement(
        diagram, "mxGraphModel",
        dx="1422", dy="762", grid="1", gridSize="10",
        connect="1", arrows="1", fold="1", page="1", pageScale="1",
        pageWidth=str(page_w), pageHeight=str(page_h),
        math="0", shadow="0",
    )
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", id="0")
    ET.SubElement(root, "mxCell", id="1", parent="0")

    for idx, (vnet, vx, vy, vw, vh) in enumerate(positions):
        is_hub = is_hub_spoke and idx == 0
        title = vnet.get("name", "VNet")
        cidr = vnet.get("cidr", "")
        region = vnet.get("region", "")
        header_bits = [title]
        if cidr:
            header_bits.append(cidr)
        if region:
            header_bits.append(region)
        vnet_label = " — ".join(header_bits)

        fill = "#dae8fc" if is_hub else "#e1d5e7"
        stroke = "#6c8ebf" if is_hub else "#9673a6"
        vnet_style = (
            f"swimlane;fontStyle=1;align=center;verticalAlign=top;horizontal=1;"
            f"startSize={VNET_HEADER_H};collapsible=0;"
            f"fillColor={fill};strokeColor={stroke};swimlaneFillColor=#ffffff;fontSize=12;"
        )
        vcell = ET.SubElement(
            root, "mxCell",
            id=f"vnet_{idx}",
            value=vnet_label,
            style=vnet_style,
            vertex="1",
            parent="1",
        )
        ET.SubElement(
            vcell, "mxGeometry",
            x=str(vx), y=str(vy),
            width=str(vw), height=str(vh),
            **{"as": "geometry"},
        )

        subnet_y = SUBNET_TOP_OFFSET
        for sidx, subnet in enumerate(vnet.get("subnets", []) or []):
            sname = subnet.get("name", "")
            scidr = subnet.get("cidr", "")
            purpose = subnet.get("purpose", "")
            pe_list = pe_by_subnet.get(sname, [])

            label_parts = [f"<b>{sname}</b> &nbsp; {scidr}"]
            if purpose:
                label_parts.append(f'<font style="font-size:9px;color:#555">{purpose}</font>')
            if pe_list:
                pe_names = ", ".join(pe.get("resource", "") for pe in pe_list)
                label_parts.append(f'<font style="font-size:9px;color:#2e7d32">PE: {pe_names}</font>')
            slabel = "<br/>".join(label_parts)

            sub_style = (
                "rounded=0;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;"
                "verticalAlign=middle;align=center;fontSize=10;"
            )
            sub_h = SUBNET_H + (10 if pe_list else 0)
            scell = ET.SubElement(
                root, "mxCell",
                id=f"subnet_{idx}_{sidx}",
                value=slabel,
                style=sub_style,
                vertex="1",
                parent=f"vnet_{idx}",
            )
            ET.SubElement(
                scell, "mxGeometry",
                x=str(SUBNET_PAD_X), y=str(subnet_y),
                width=str(vw - 2 * SUBNET_PAD_X), height=str(sub_h),
                **{"as": "geometry"},
            )
            subnet_y += sub_h + SUBNET_GAP_Y

    # Peering edges
    if is_hub_spoke and len(vnets) >= 2:
        for i in range(1, len(vnets)):
            edge = ET.SubElement(
                root, "mxCell",
                id=f"peer_{i}",
                value="VNet Peering",
                style=(
                    "endArrow=classic;startArrow=classic;html=1;rounded=0;"
                    "edgeStyle=orthogonalEdgeStyle;strokeColor=#6c8ebf;fontSize=10;"
                ),
                edge="1",
                source="vnet_0",
                target=f"vnet_{i}",
                parent="1",
            )
            ET.SubElement(edge, "mxGeometry", relative="1", **{"as": "geometry"})
    elif topology_type == "peered" and len(vnets) >= 2:
        for i in range(len(vnets) - 1):
            edge = ET.SubElement(
                root, "mxCell",
                id=f"peer_{i}",
                value="Peering",
                style=(
                    "endArrow=classic;startArrow=classic;html=1;rounded=0;"
                    "edgeStyle=orthogonalEdgeStyle;strokeColor=#6c8ebf;fontSize=10;"
                ),
                edge="1",
                source=f"vnet_{i}",
                target=f"vnet_{i+1}",
                parent="1",
            )
            ET.SubElement(edge, "mxGeometry", relative="1", **{"as": "geometry"})

    # Footer note: firewall, DNS, NSG summary
    note_lines: list[str] = []
    if firewall:
        note_lines.append(f"<b>Firewall:</b> {firewall}")
    if dns_design:
        note_lines.append(f"<b>DNS:</b> {dns_design}")
    if nsg_rules:
        rules_summary = ", ".join(
            f"{r.get('name', '')} ({r.get('action', '')} {r.get('port', '')})"
            for r in nsg_rules[:5]
        )
        suffix = " …" if len(nsg_rules) > 5 else ""
        note_lines.append(f"<b>NSG Rules:</b> {rules_summary}{suffix}")

    if note_lines:
        note_style = (
            "text;html=1;align=left;verticalAlign=top;fillColor=#f5f5f5;strokeColor=#666666;"
            "rounded=1;fontSize=10;spacing=8;whiteSpace=wrap;"
        )
        note_cell = ET.SubElement(
            root, "mxCell",
            id="notes",
            value="<br/>".join(note_lines),
            style=note_style,
            vertex="1",
            parent="1",
        )
        note_w = min(canvas_w - 2 * MARGIN, 720)
        note_h = 22 * len(note_lines) + 16
        ET.SubElement(
            note_cell, "mxGeometry",
            x=str(MARGIN), y=str(canvas_h + 16),
            width=str(note_w), height=str(note_h),
            **{"as": "geometry"},
        )

    return _serialize(mxfile)

