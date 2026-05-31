import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { apiFetch } from "../config/api";

interface DriftReport {
  subscription_id: string;
  reference_arch: { id: string; title: string };
  summary: { total_resources: number; public_ips: number };
  findings: {
    service_coverage: { expected: string[]; present: string[]; missing: string[] };
    tag_violations: Array<{ id: string; name: string; type: string; missing_tags: string[] }>;
    public_exposure: Array<{ id: string; name: string; ip: string; resource_group: string }>;
    open_management_ports: Array<{ nsg: string; rule: string; port: string; protocol: string; resource_group: string }>;
  };
}

interface ReferenceArch {
  id: string;
  title: string;
}

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL, padding: tokens.spacingVerticalL },
  controls: { display: "flex", gap: tokens.spacingHorizontalM, alignItems: "flex-end", flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: tokens.spacingVerticalM },
  finding: { padding: tokens.spacingVerticalS },
  error: { color: tokens.colorPaletteRedForeground1 },
  count: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorPaletteRedForeground1 },
});

export default function DriftPanel() {
  const styles = useStyles();
  const [archs, setArchs] = useState<ReferenceArch[]>([]);
  const [archId, setArchId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DriftReport | null>(null);

  useEffect(() => {
    apiFetch("/api/reference/architectures")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.architectures || [];
        setArchs(list);
        if (list.length && !archId) setArchId(list[0].id);
      })
      .catch(() => setArchs([]));
  }, []);

  async function runScan() {
    if (!archId) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const qs = new URLSearchParams({ reference_arch_id: archId });
      if (subscriptionId) qs.set("subscription_id", subscriptionId);
      const res = await apiFetch(`/api/scan/drift?${qs.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `scan failed (${res.status})`);
      }
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <Field label="Reference architecture">
          <Select value={archId} onChange={(_, d) => setArchId(d.value)}>
            {archs.map((a) => (
              <option key={a.id} value={a.id}>{a.title}</option>
            ))}
          </Select>
        </Field>
        <Field label="Subscription ID (optional)">
          <Input value={subscriptionId} onChange={(_, d) => setSubscriptionId(d.value)} placeholder="defaults to server config" />
        </Field>
        <Button appearance="primary" onClick={runScan} disabled={loading || !archId}>
          {loading ? <Spinner size="tiny" /> : "Run drift scan"}
        </Button>
      </div>

      {error && <Text className={styles.error}>{error}</Text>}

      {report && (
        <>
          <Text>
            Scanned subscription <code>{report.subscription_id}</code> against{" "}
            <b>{report.reference_arch.title}</b> — {report.summary.total_resources} resources,{" "}
            {report.summary.public_ips} public IPs.
          </Text>
          <div className={styles.grid}>
            <Card>
              <CardHeader header={<Text weight="semibold">Service coverage</Text>} />
              <div className={styles.finding}>
                <Text>Missing: <span className={styles.count}>{report.findings.service_coverage.missing.length}</span></Text>
                <ul>{report.findings.service_coverage.missing.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            </Card>
            <Card>
              <CardHeader header={<Text weight="semibold">Tag violations</Text>} />
              <div className={styles.finding}>
                <Text className={styles.count}>{report.findings.tag_violations.length}</Text>
                <ul>{report.findings.tag_violations.slice(0, 10).map((v) => (
                  <li key={v.id}>{v.name} — missing {v.missing_tags.join(", ")}</li>
                ))}</ul>
              </div>
            </Card>
            <Card>
              <CardHeader header={<Text weight="semibold">Public exposure</Text>} />
              <div className={styles.finding}>
                <Text className={styles.count}>{report.findings.public_exposure.length}</Text>
                <ul>{report.findings.public_exposure.slice(0, 10).map((p) => (
                  <li key={p.id}>{p.name} ({p.ip})</li>
                ))}</ul>
              </div>
            </Card>
            <Card>
              <CardHeader header={<Text weight="semibold">Open management ports</Text>} />
              <div className={styles.finding}>
                <Text className={styles.count}>{report.findings.open_management_ports.length}</Text>
                <ul>{report.findings.open_management_ports.slice(0, 10).map((r, i) => (
                  <li key={i}>{r.nsg}/{r.rule} — port {r.port}/{r.protocol}</li>
                ))}</ul>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
