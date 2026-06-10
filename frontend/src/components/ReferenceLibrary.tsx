import { useEffect, useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Input,
  Text,
  Badge,
  Card,
  CardHeader,
  Spinner,
  Select,
  Link,
  ProgressBar,
} from "@fluentui/react-components";
import {
  ArrowUpRightRegular,
  FilterRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import type { ReferenceArch } from "../types";
import { apiFetch } from "../config/api";

const COMPLEXITY_COLOR: Record<string, "informative" | "warning" | "danger"> = {
  Low: "informative", Medium: "warning", High: "danger",
};

const WAF_PILLAR_KEYS = ["reliability", "security", "cost", "operations", "performance"];
const WAF_LABELS: Record<string, string> = {
  reliability: "Rel", security: "Sec", cost: "Cost", operations: "Ops", performance: "Perf",
};

const useStyles = makeStyles({
  panel: { display: "flex", height: "100%", overflow: "hidden" },
  sidebar: {
    width: "280px",
    minWidth: "240px",
    padding: "16px",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    background: tokens.colorNeutralBackground1,
  },
  main: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "0",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "12px",
  },
  archCard: {
    cursor: "pointer",
    transition: "box-shadow 0.15s",
    "&:hover": {
      boxShadow: tokens.shadow8,
    },
  },
  archCardActive: {
    border: `2px solid ${tokens.colorBrandStroke1}`,
  },
  cardServices: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    marginTop: "6px",
  },
  cardWaf: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
    alignItems: "center",
  },
  wafPillar: { textAlign: "center", flex: 1 },
  wafBar: { height: "4px", borderRadius: "2px" },
  detailPanel: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    width: "420px",
    height: "100%",
    background: tokens.colorNeutralBackground1,
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    boxShadow: tokens.shadow28,
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "8px",
  },
  detailTitle: {
    fontSize: "18px",
    fontWeight: 700,
  },
  filterRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    marginBottom: "12px",
  },
  totalCount: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginBottom: "12px",
  },
  wafScoreRow: {
    display: "flex",
    gap: "4px",
    marginTop: "4px",
  },
  wafScoreChip: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    flex: 1,
  },
  wafLabel: {
    fontSize: "10px",
    color: tokens.colorNeutralForeground3,
  },
  wafVal: {
    fontSize: "12px",
    fontWeight: 700,
  },
});

const WAF_SCORE_COLOR = (score: number) => {
  if (score >= 4) return tokens.colorPaletteGreenForeground1;
  if (score === 3) return tokens.colorPaletteYellowForeground1;
  return tokens.colorPaletteRedForeground1;
};

export default function ReferenceLibrary() {
  const styles = useStyles();
  const [archs, setArchs] = useState<ReferenceArch[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [selected, setSelected] = useState<ReferenceArch | null>(null);

  useEffect(() => {
    fetchArchs("", "", "");
  }, []);

  async function fetchArchs(q: string, cat: string, tag: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (cat) params.set("category", cat);
      if (tag) params.set("tag", tag);
      const resp = await apiFetch(`/api/reference-architectures?${params}`);
      const data = await resp.json();
      setArchs(data.architectures ?? []);
      if (data.categories?.length) setCategories(data.categories);
      if (data.tags?.length) setTags(data.tags);
    } catch {
      setArchs([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    fetchArchs(query, filterCategory, "");
  }

  function handleCategoryChange(cat: string) {
    setFilterCategory(cat);
    fetchArchs(query, cat, "");
  }

  return (
    <div className={styles.panel} style={{ position: "relative" }}>
      <div className={styles.sidebar}>
        <Text weight="semibold" size={400}>Reference Library</Text>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {archs.length} curated Azure reference architectures
        </Text>

        <Input
          placeholder="Search architectures…"
          contentBefore={<SearchRegular />}
          value={query}
          onChange={(_, d) => setQuery(d.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />

        <div>
          <Text size={200} style={{ display: "block", marginBottom: 4 }}>Category</Text>
          <Select
            value={filterCategory}
            onChange={(_, d) => handleCategoryChange(d.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </Select>
        </div>

        <Button
          appearance="primary"
          icon={<FilterRegular />}
          onClick={handleSearch}
        >
          Search
        </Button>

        <div>
          <Text size={200} weight="semibold" block style={{ marginBottom: 6 }}>Tags</Text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {tags.slice(0, 20).map((t) => (
              <Badge
                key={t}
                appearance="tint"
                size="small"
                style={{ cursor: "pointer" }}
                onClick={() => fetchArchs(query, filterCategory, t)}
              >
                {t}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.main}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
            <Spinner label="Loading architectures…" />
          </div>
        ) : (
          <>
            <Text className={styles.totalCount}>{archs.length} architectures</Text>
            <div className={styles.grid}>
              {archs.map((arch) => (
                <Card
                  key={arch.id}
                  className={`${styles.archCard} ${selected?.id === arch.id ? styles.archCardActive : ""}`}
                  onClick={() => setSelected(arch)}
                >
                  <CardHeader
                    header={
                      <div>
                        <Text weight="semibold" size={300}>{arch.title}</Text>
                        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                          <Badge appearance="tint" size="small" color="brand">{arch.category}</Badge>
                          <Badge appearance="tint" size="small" color={COMPLEXITY_COLOR[arch.complexity] ?? "informative"}>
                            {arch.complexity}
                          </Badge>
                          <Badge appearance="tint" size="small" color="success">{arch.estimated_monthly}</Badge>
                        </div>
                      </div>
                    }
                  />
                  <div style={{ padding: "0 12px 12px" }}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block" }}>
                      {arch.description.slice(0, 100)}…
                    </Text>
                    <div className={styles.cardServices}>
                      {arch.services.slice(0, 4).map((s) => (
                        <Badge key={s} appearance="outline" size="small">{s}</Badge>
                      ))}
                      {arch.services.length > 4 && (
                        <Badge appearance="outline" size="small">+{arch.services.length - 4}</Badge>
                      )}
                    </div>
                    <div className={styles.wafScoreRow}>
                      {WAF_PILLAR_KEYS.map((k) => (
                        <div key={k} className={styles.wafScoreChip}>
                          <Text className={styles.wafLabel}>{WAF_LABELS[k]}</Text>
                          <Text className={styles.wafVal} style={{ color: WAF_SCORE_COLOR(arch.waf_score[k] ?? 0) }}>
                            {arch.waf_score[k] ?? "?"}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className={styles.detailPanel}>
          <div className={styles.detailHeader}>
            <Text className={styles.detailTitle}>{selected.title}</Text>
            <Button appearance="subtle" size="small" onClick={() => setSelected(null)}>✕</Button>
          </div>

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <Badge appearance="tint" color="brand">{selected.category}</Badge>
            <Badge appearance="tint" color={COMPLEXITY_COLOR[selected.complexity] ?? "informative"}>
              {selected.complexity} complexity
            </Badge>
            <Badge appearance="tint" color="success">{selected.estimated_monthly}/mo</Badge>
          </div>

          <Text size={300}>{selected.description}</Text>

          <div>
            <Text weight="semibold" size={300} block style={{ marginBottom: 6 }}>Services</Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {selected.services.map((s) => (
                <Badge key={s} appearance="tint">{s}</Badge>
              ))}
            </div>
          </div>

          <div>
            <Text weight="semibold" size={300} block style={{ marginBottom: 8 }}>WAF Scores</Text>
            {WAF_PILLAR_KEYS.map((k) => (
              <div key={k} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <Text size={200}>{k.charAt(0).toUpperCase() + k.slice(1)}</Text>
                  <Text size={200} weight="semibold">{selected.waf_score[k] ?? "?"}/5</Text>
                </div>
                <ProgressBar value={(selected.waf_score[k] ?? 0) / 5} />
              </div>
            ))}
          </div>

          <div>
            <Text weight="semibold" size={300} block style={{ marginBottom: 6 }}>Tags</Text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {selected.tags.map((t) => (
                <Badge key={t} appearance="outline" size="small">{t}</Badge>
              ))}
            </div>
          </div>

          <Link href={selected.learn_url} target="_blank" rel="noopener noreferrer">
            <Button appearance="primary" icon={<ArrowUpRightRegular />} style={{ width: "100%" }}>
              View on Microsoft Learn
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
