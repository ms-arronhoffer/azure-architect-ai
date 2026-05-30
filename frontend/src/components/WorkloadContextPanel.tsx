import { useState } from "react";
import {
  makeStyles,
  tokens,
  Button,
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  Field,
  Select,
  Input,
  Textarea,
  Text,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { WorkloadContext } from "../types";

const AZURE_REGIONS = [
  "East US", "East US 2", "West US", "West US 2", "West US 3",
  "Central US", "North Central US", "South Central US", "West Central US",
  "North Europe", "West Europe", "UK South", "UK West",
  "France Central", "Germany West Central", "Switzerland North",
  "Australia East", "Australia Southeast",
  "Southeast Asia", "East Asia", "Japan East", "Japan West",
  "Korea Central", "India Central", "Brazil South",
  "Canada Central", "Canada East",
  "UAE North", "South Africa North",
];

const COMPLIANCE_FRAMEWORKS = ["None", "HIPAA", "PCI-DSS", "SOC 2", "FedRAMP", "GDPR", "ISO 27001", "NIST 800-53"];

const useStyles = makeStyles({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px 0",
  },
  actions: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
  },
});

interface WorkloadContextPanelProps {
  open: boolean;
  onClose: () => void;
  context: WorkloadContext;
  onSave: (ctx: WorkloadContext) => void;
  onClear: () => void;
}

export default function WorkloadContextPanel({ open, onClose, context, onSave, onClear }: WorkloadContextPanelProps) {
  const styles = useStyles();
  const [draft, setDraft] = useState<WorkloadContext>(context);

  function handleOpen() {
    setDraft(context);
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  function handleClear() {
    onClear();
    onClose();
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(_, { open: o }) => { if (!o) onClose(); }}
      position="end"
      size="medium"
      onTransitionEnd={() => { if (open) handleOpen(); }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" icon={<DismissRegular />} onClick={onClose} />
          }
        >
          Workload Context
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block", marginBottom: "12px" }}>
          Set persistent workload details that will be injected as context into all AI requests.
        </Text>
        <div className={styles.body}>
          <Field label="Primary Azure Region">
            <Select
              value={draft.region}
              onChange={(_, d) => setDraft((p) => ({ ...p, region: d.value }))}
            >
              <option value="">— Select region —</option>
              {AZURE_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Compliance Framework">
            <Select
              value={draft.complianceFramework}
              onChange={(_, d) => setDraft((p) => ({ ...p, complianceFramework: d.value === "None" ? "" : d.value }))}
            >
              {COMPLIANCE_FRAMEWORKS.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          </Field>
          <Field label="Monthly Budget Range" hint='e.g. "$10k–50k/mo"'>
            <Input
              value={draft.budgetRange}
              onChange={(_, d) => setDraft((p) => ({ ...p, budgetRange: d.value }))}
              placeholder="e.g. $10k–50k/mo"
            />
          </Field>
          <Field label="Team Size" hint='e.g. "5–10 engineers"'>
            <Input
              value={draft.teamSize}
              onChange={(_, d) => setDraft((p) => ({ ...p, teamSize: d.value }))}
              placeholder="e.g. 5–10 engineers"
            />
          </Field>
          <Field label="Additional Notes">
            <Textarea
              rows={3}
              value={draft.notes}
              onChange={(_, d) => setDraft((p) => ({ ...p, notes: d.value }))}
              placeholder="Any other constraints or context for the AI…"
            />
          </Field>
          <div className={styles.actions}>
            <Button appearance="primary" onClick={handleSave}>Save Context</Button>
            <Button appearance="outline" onClick={handleClear}>Clear</Button>
            <Button appearance="subtle" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DrawerBody>
    </Drawer>
  );
}
