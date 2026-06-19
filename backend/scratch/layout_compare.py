"""Prototype: cluster-grouped layout for dense Azure topologies.

Run from `backend/`:
    python -m scratch.layout_compare

Each component carries a `group` hint (edge | compute | data | observability |
external). Within each tier, group members are placed contiguously, then a
dashed cluster rectangle is rendered behind the nodes. Inter-cluster edges
share a single corridor between cluster boundaries and get channel offsets so
parallel edges don't stack.

Emits three files for visual comparison:
    - current.drawio          (existing layout, no grouping)
    - clustered.drawio        (group-aware layout + cluster boxes)
    - clustered_routed.drawio (clusters + channel-routed inter-cluster edges)
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.diagram_service import (
    NODE_H,
    NODE_W,
    X_GAP,
    Y_GAP,
    Y_START,
    generate_diagram,
)


# Cluster colors — dashed strokes, no fill, soft pastels
CLUSTER_STYLE = {
    "external":      "#9aa0a6",
    "edge":          "#1976d2",
    "compute":       "#388e3c",
    "data":          "#f57c00",
    "observability": "#7b1fa2",
}

CLUSTER_LABELS = {
    "external": "External",
    "edge": "Edge / Ingress",
    "compute": "Compute",
    "data": "Data",
    "observability": "Observability",
}


COMPONENTS = [
    {"id": "user",     "label": "Users",           "shape": "user",                 "tier": 1, "group": "external"},
    {"id": "front",    "label": "Front Door",      "shape": "front-door",           "tier": 2, "group": "edge"},
    {"id": "waf",      "label": "WAF Policy",      "shape": "waf",                  "tier": 2, "group": "edge"},
    {"id": "app1",     "label": "App API",         "shape": "app-services",         "tier": 3, "group": "compute"},
    {"id": "app2",     "label": "Web Frontend",    "shape": "app-services",         "tier": 3, "group": "compute"},
    {"id": "app3",     "label": "Worker",          "shape": "app-services",         "tier": 3, "group": "compute"},
    {"id": "app4",     "label": "Admin Portal",    "shape": "app-services",         "tier": 3, "group": "compute"},
    {"id": "func",     "label": "Functions",       "shape": "functions",            "tier": 3, "group": "compute"},
    {"id": "sql",      "label": "Azure SQL",       "shape": "sql-database",         "tier": 4, "group": "data"},
    {"id": "redis",    "label": "Redis Cache",     "shape": "cache-redis",          "tier": 4, "group": "data"},
    {"id": "storage",  "label": "Storage",         "shape": "storage-accounts",     "tier": 4, "group": "data"},
    {"id": "kv",       "label": "Key Vault",       "shape": "key-vaults",           "tier": 4, "group": "data"},
    {"id": "monitor",  "label": "Azure Monitor",   "shape": "monitor",              "tier": 5, "group": "observability"},
    {"id": "appins",   "label": "App Insights",    "shape": "application-insights", "tier": 5, "group": "observability"},
]

CONNECTIONS = [
    {"from": "user",    "to": "front"},
    {"from": "front",   "to": "waf",     "label": "policy"},
    {"from": "front",   "to": "app1"},
    {"from": "front",   "to": "app2"},
    {"from": "front",   "to": "app3"},
    {"from": "front",   "to": "app4"},
    {"from": "app1",    "to": "func"},
    {"from": "app1",    "to": "sql"},
    {"from": "app2",    "to": "sql"},
    {"from": "app3",    "to": "sql"},
    {"from": "app4",    "to": "sql"},
    {"from": "app1",    "to": "redis"},
    {"from": "app2",    "to": "redis"},
    {"from": "app3",    "to": "storage"},
    {"from": "app4",    "to": "storage"},
    {"from": "app1",    "to": "kv"},
    {"from": "app2",    "to": "kv"},
    {"from": "app3",    "to": "kv"},
    {"from": "app4",    "to": "kv"},
    {"from": "func",    "to": "kv"},
    {"from": "app1",    "to": "appins"},
    {"from": "app2",    "to": "appins"},
    {"from": "app3",    "to": "appins"},
    {"from": "app4",    "to": "appins"},
    {"from": "appins",  "to": "monitor"},
    {"from": "sql",     "to": "monitor", "label": "logs"},
]

# Stable visual order for groups within a tier (left to right)
GROUP_ORDER = ["external", "edge", "compute", "data", "observability"]
_GROUP_RANK = {g: i for i, g in enumerate(GROUP_ORDER)}

# Padding inside cluster rectangles
CLUSTER_PAD_X = 24
CLUSTER_PAD_Y = 36   # extra room at top for the cluster label
CLUSTER_GAP_X = 60   # horizontal space between adjacent cluster boxes


def cluster_layout(components, connections):
    """Group-aware layered layout.

    Within each tier:
      - bucket nodes by group, in GROUP_ORDER
      - within each bucket, barycenter-sort against already-placed neighbors
      - place buckets left-to-right with CLUSTER_GAP_X between bucket spans

    Returns (components, clusters) where clusters is a list of dicts:
      {"tier": int, "group": str, "x": int, "y": int, "w": int, "h": int, "members": [ids]}
    """
    out = [dict(c) for c in components]
    by_id = {c["id"]: c for c in out}

    adj = defaultdict(set)
    for conn in connections:
        adj[conn["from"]].add(conn["to"])
        adj[conn["to"]].add(conn["from"])

    tiers = defaultdict(list)
    for c in out:
        tiers[int(c.get("tier", 2))].append(c)

    placed_x = {}
    clusters = []

    row_y = Y_START
    for tier_idx in sorted(tiers):
        row = tiers[tier_idx]

        # Bucket by group, ordered by GROUP_ORDER
        buckets = defaultdict(list)
        for comp in row:
            buckets[comp.get("group", "compute")].append(comp)
        ordered_groups = sorted(buckets.keys(), key=lambda g: _GROUP_RANK.get(g, 99))

        # Barycenter-sort within each bucket
        def _bary(c):
            xs = [placed_x[n] for n in adj[c["id"]] if n in placed_x]
            return sum(xs) / len(xs) if xs else 0.0

        for g in ordered_groups:
            buckets[g].sort(key=_bary)

        # Total width to size the canvas / center the row
        total_w = 0
        bucket_widths = {}
        for g in ordered_groups:
            n = len(buckets[g])
            w = n * NODE_W + (n - 1) * (X_GAP - NODE_W) + 2 * CLUSTER_PAD_X
            bucket_widths[g] = w
            total_w += w
        total_w += (len(ordered_groups) - 1) * CLUSTER_GAP_X

        # Page width matches the widest tier so canvases align
        page_width = max(1169, total_w + 240)
        x_cursor = max(80, (page_width - total_w) // 2)

        for g in ordered_groups:
            members = buckets[g]
            cluster_x = x_cursor
            cluster_y = row_y - NODE_H // 2 - CLUSTER_PAD_Y + 6
            cluster_w = bucket_widths[g]
            cluster_h = NODE_H + CLUSTER_PAD_Y + 16

            # Place each member node inside this bucket
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

    return out, clusters


def inject_clusters(xml_str, clusters):
    """Insert cluster background rectangles BEFORE the node cells so they
    render behind the nodes."""
    root = ET.fromstring(xml_str)
    model_root = root.find(".//root")
    if model_root is None:
        return xml_str

    # All node/edge cells currently live as children of `root` (the mxGraphModel
    # root). We want cluster rectangles to appear after the base cells (id="0",
    # id="1") but before any node_* cell.
    children = list(model_root)
    insert_at = 0
    for i, child in enumerate(children):
        cid = child.get("id", "")
        if cid in ("0", "1"):
            insert_at = i + 1
        else:
            break

    new_elements = []
    for idx, cl in enumerate(clusters):
        color = CLUSTER_STYLE.get(cl["group"], "#888888")
        label = CLUSTER_LABELS.get(cl["group"], cl["group"].title())
        style = (
            f"rounded=1;whiteSpace=wrap;html=1;"
            f"fillColor=none;strokeColor={color};dashed=1;dashPattern=4 4;"
            f"verticalAlign=top;align=left;fontSize=11;fontColor={color};"
            f"spacingTop=4;spacingLeft=10;strokeWidth=1.5;"
        )
        cell = ET.Element("mxCell", {
            "id": f"cluster_{idx}",
            "value": label,
            "style": style,
            "vertex": "1",
            "parent": "1",
        })
        ET.SubElement(cell, "mxGeometry", {
            "x": str(cl["x"]), "y": str(cl["y"]),
            "width": str(cl["w"]), "height": str(cl["h"]),
            "as": "geometry",
        })
        new_elements.append(cell)

    # Insert in reverse so the order is preserved
    for elem in reversed(new_elements):
        model_root.insert(insert_at, elem)

    return ET.tostring(root, encoding="unicode")


def compute_cluster_channel_waypoints(components, connections, clusters):
    """Route inter-cluster edges through one channel between cluster boundaries.

    For every (src_cluster, tgt_cluster) pair that has multiple edges, give
    each edge a unique horizontal track Y in the gap between the two clusters
    so parallel edges no longer stack.
    """
    by_id = {c["id"]: c for c in components}
    cluster_by_id = {}
    for cl in clusters:
        for m in cl["members"]:
            cluster_by_id[m] = cl

    groups = defaultdict(list)
    for conn in connections:
        s = by_id.get(conn["from"])
        t = by_id.get(conn["to"])
        if not (s and t):
            continue
        sc = cluster_by_id.get(s["id"])
        tc = cluster_by_id.get(t["id"])
        if sc is None or tc is None or sc is tc:
            continue  # intra-cluster: let draw.io orthogonal route handle it
        groups[(id(sc), id(tc))].append((conn, s, t, sc, tc))

    waypoints = {}
    for key, items in groups.items():
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

        for slot, (conn, s, t, sc, tc) in enumerate(items):
            track_y = (
                (band_top + band_bot) / 2 if n == 1
                else band_top + band_h * (slot / (n - 1))
            )
            sx = s["x"] + NODE_W / 2
            tx = t["x"] + NODE_W / 2
            waypoints[(conn["from"], conn["to"])] = [(sx, track_y), (tx, track_y)]

    return waypoints


def inject_waypoints(xml_str, waypoints):
    if not waypoints:
        return xml_str
    root = ET.fromstring(xml_str)
    for cell in root.iter("mxCell"):
        src = cell.get("source")
        tgt = cell.get("target")
        if not (src and tgt):
            continue
        pts = waypoints.get((src, tgt))
        if not pts:
            continue
        geom = cell.find("mxGeometry")
        if geom is None:
            continue
        for old in geom.findall("Array"):
            geom.remove(old)
        arr = ET.SubElement(geom, "Array", {"as": "points"})
        for x, y in pts:
            ET.SubElement(arr, "mxPoint", {"x": str(int(x)), "y": str(int(y))})
    return ET.tostring(root, encoding="unicode")


def _count_segment_crossings(components, connections, waypoints=None):
    by_id = {c["id"]: c for c in components}
    waypoints = waypoints or {}
    edges = []
    for conn in connections:
        s = by_id.get(conn["from"])
        t = by_id.get(conn["to"])
        if not (s and t):
            continue
        sx = s["x"] + NODE_W / 2
        sy = s["y"] + NODE_H / 2
        tx = t["x"] + NODE_W / 2
        ty = t["y"] + NODE_H / 2
        pts = [(sx, sy)] + waypoints.get((conn["from"], conn["to"]), []) + [(tx, ty)]
        segs = list(zip(pts, pts[1:]))
        edges.append(((conn["from"], conn["to"]), segs))

    def intersect(p1, p2, p3, p4):
        (x1, y1), (x2, y2) = p1, p2
        (x3, y3), (x4, y4) = p3, p4
        denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if denom == 0:
            return False
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
        u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom
        return 0.01 < t < 0.99 and 0.01 < u < 0.99

    n = 0
    for i in range(len(edges)):
        a_pair, a_segs = edges[i]
        for j in range(i + 1, len(edges)):
            b_pair, b_segs = edges[j]
            if set(a_pair) & set(b_pair):
                continue
            done = False
            for s1 in a_segs:
                for s2 in b_segs:
                    if intersect(s1[0], s1[1], s2[0], s2[1]):
                        n += 1
                        done = True
                        break
                if done:
                    break
    return n


def _count_stacked_parallel(components, connections, waypoints=None):
    """Count pairs of edges that share a (src_row, tgt_row) corridor with no
    horizontal offset between them — the 'fat line' visual artifact.
    """
    by_id = {c["id"]: c for c in components}
    waypoints = waypoints or {}
    corridors = defaultdict(list)
    for conn in connections:
        s = by_id.get(conn["from"])
        t = by_id.get(conn["to"])
        if not (s and t):
            continue
        sy = int(s["y"]) // 100
        ty = int(t["y"]) // 100
        if sy == ty:
            continue
        # If waypoint adds a unique track_y, edge is not stacked
        wp = waypoints.get((conn["from"], conn["to"]))
        track = wp[0][1] if wp else (s["y"] + t["y"]) / 2
        corridors[(sy, ty)].append(track)

    stacked_pairs = 0
    for tracks in corridors.values():
        # Count pairs that are within 5px of each other in track Y
        tracks.sort()
        for i in range(len(tracks)):
            for j in range(i + 1, len(tracks)):
                if abs(tracks[i] - tracks[j]) < 5:
                    stacked_pairs += 1
    return stacked_pairs


def main():
    out_dir = Path(__file__).resolve().parent
    runs = []

    # 1. Current layout (no groups)
    cur = [dict(c) for c in COMPONENTS]
    cur_xml = generate_diagram(cur, CONNECTIONS, title="Current Layout")
    (out_dir / "current.drawio").write_text(cur_xml, encoding="utf-8")
    runs.append(("current",
                 _count_segment_crossings(cur, CONNECTIONS),
                 _count_stacked_parallel(cur, CONNECTIONS),
                 0))

    # 2. Clustered layout, no edge routing
    cl_comps, clusters = cluster_layout(COMPONENTS, CONNECTIONS)
    cl_xml = generate_diagram(cl_comps, CONNECTIONS, title="Clustered Layout")
    cl_xml = inject_clusters(cl_xml, clusters)
    (out_dir / "clustered.drawio").write_text(cl_xml, encoding="utf-8")
    runs.append(("clustered",
                 _count_segment_crossings(cl_comps, CONNECTIONS),
                 _count_stacked_parallel(cl_comps, CONNECTIONS),
                 0))

    # 3. Clustered + inter-cluster channel routing
    cl_comps2, clusters2 = cluster_layout(COMPONENTS, CONNECTIONS)
    wp = compute_cluster_channel_waypoints(cl_comps2, CONNECTIONS, clusters2)
    cr_xml = generate_diagram(cl_comps2, CONNECTIONS, title="Clustered + Routed")
    cr_xml = inject_clusters(cr_xml, clusters2)
    cr_xml = inject_waypoints(cr_xml, wp)
    (out_dir / "clustered_routed.drawio").write_text(cr_xml, encoding="utf-8")
    runs.append(("clustered_routed",
                 _count_segment_crossings(cl_comps2, CONNECTIONS, wp),
                 _count_stacked_parallel(cl_comps2, CONNECTIONS, wp),
                 len(wp)))

    print(f"\nWrote 3 .drawio files in {out_dir}\n")
    print(f"  {'variant':<20} {'crossings':>10} {'stacked':>10} {'waypoints':>10}")
    for name, crossings, stacked, wp_count in runs:
        print(f"  {name:<20} {crossings:>10} {stacked:>10} {wp_count:>10}")
    print("\ncrossings = segment intersections (raw count)")
    print("stacked   = pairs of edges in same row-gap with overlapping track Y")
    print("            (this is the 'fat line' artifact — lower is better)")
    print("\nOpen all three .drawio files in https://app.diagrams.net.")


if __name__ == "__main__":
    main()
