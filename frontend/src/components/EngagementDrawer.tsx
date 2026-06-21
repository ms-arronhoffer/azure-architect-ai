import { useEffect, useState } from "react";
import {
  Drawer,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerBody,
  Button,
  Input,
  Textarea,
  Field,
  Divider,
  Text,
  MessageBar,
  makeStyles,
  tokens,
  Card,
  Badge,
} from "@fluentui/react-components";
import { DismissRegular, AddRegular, DeleteRegular, SaveRegular } from "@fluentui/react-icons";
import type { Engagement, EngagementWrite } from "../hooks/useEngagements";
import { EngagementReferencesSection } from "./EngagementReferencesSection";
import { EngagementInventorySection } from "./EngagementInventorySection";
import { EngagementArbSection } from "./EngagementArbSection";

const useStyles = makeStyles({
  body: { padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" },
  list: { display: "flex", flexDirection: "column", gap: "8px" },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    cursor: "pointer",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
  },
  rowActive: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorBrandBackground2,
  },
  rowLeft: { display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 },
  rowName: { fontWeight: 600, fontSize: "13px" },
  rowMeta: { fontSize: "11px", color: tokens.colorNeutralForeground3 },
  form: { display: "flex", flexDirection: "column", gap: "10px" },
  actions: { display: "flex", gap: "8px", justifyContent: "flex-end" },
  formHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
});

interface Props {
  open: boolean;
  onClose: () => void;
  engagements: Engagement[];
  active: Engagement | null;
  onSelect: (id: string | null) => void;
  onCreate: (body: EngagementWrite) => Promise<Engagement>;
  onUpdate: (id: string, body: EngagementWrite) => Promise<Engagement>;
  onDelete: (id: string) => Promise<void>;
}

interface FormState {
  name: string;
  customer_name: string;
  industry: string;
  compliance_frameworks: string;
  subscription_ids: string;
  region_preference: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  customer_name: "",
  industry: "",
  compliance_frameworks: "",
  subscription_ids: "",
  region_preference: "",
  notes: "",
};

function toForm(e: Engagement | null): FormState {
  if (!e) return EMPTY_FORM;
  return {
    name: e.name,
    customer_name: e.customer_name ?? "",
    industry: e.industry ?? "",
    compliance_frameworks: (e.compliance_frameworks ?? []).join(", "),
    subscription_ids: (e.subscription_ids ?? []).join(", "),
    region_preference: e.region_preference ?? "",
    notes: e.notes ?? "",
  };
}

function toWrite(f: FormState): EngagementWrite {
  const csv = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);
  return {
    name: f.name.trim(),
    customer_name: f.customer_name.trim(),
    industry: f.industry.trim() || null,
    compliance_frameworks: csv(f.compliance_frameworks),
    subscription_ids: csv(f.subscription_ids),
    region_preference: f.region_preference.trim() || null,
    notes: f.notes,
  };
}

export default function EngagementDrawer({
  open,
  onClose,
  engagements,
  active,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const styles = useStyles();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setCreating(false);
      setMessage(null);
    }
  }, [open]);

  const editing = editingId ? engagements.find((e) => e.id === editingId) ?? null : null;

  function startCreate() {
    setEditingId(null);
    setCreating(true);
    setForm(EMPTY_FORM);
  }

  function startEdit(e: Engagement) {
    setCreating(false);
    setEditingId(e.id);
    setForm(toForm(e));
  }

  function notify(kind: "success" | "error", text: string) {
    setMessage({ kind, text });
    setTimeout(() => setMessage(null), 4000);
  }

  async function save() {
    if (!form.name.trim()) {
      notify("error", "Name is required");
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await onUpdate(editingId, toWrite(form));
        notify("success", "Engagement updated");
      } else {
        const created = await onCreate(toWrite(form));
        notify("success", "Engagement created");
        onSelect(created.id);
      }
      setEditingId(null);
      setCreating(false);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this engagement? Its conversations will become unscoped.")) return;
    setBusy(true);
    try {
      await onDelete(id);
      notify("success", "Engagement deleted");
      setEditingId(null);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const formOpen = creating || editing !== null;

  return (
    <Drawer open={open} onOpenChange={(_, d) => !d.open && onClose()} position="end" size="medium">
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button appearance="subtle" icon={<DismissRegular />} onClick={onClose} />
          }
        >
          Engagements
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody className={styles.body}>
        {message && (
          <MessageBar intent={message.kind === "success" ? "success" : "error"}>
            {message.text}
          </MessageBar>
        )}

        {!formOpen && (
          <>
            <div className={styles.actions}>
              <Button icon={<AddRegular />} appearance="primary" onClick={startCreate}>
                New engagement
              </Button>
            </div>
            <div className={styles.list}>
              {engagements.length === 0 && (
                <Text style={{ color: tokens.colorNeutralForeground3, fontSize: "12px" }}>
                  No engagements yet. Create one to scope cost + scan queries to a customer.
                </Text>
              )}
              {engagements.map((e) => {
                const isActive = e.id === active?.id;
                return (
                  <Card
                    key={e.id}
                    className={`${styles.row} ${isActive ? styles.rowActive : ""}`}
                    onClick={() => onSelect(e.id)}
                  >
                    <div className={styles.rowLeft}>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <Text className={styles.rowName}>{e.name}</Text>
                        {isActive && <Badge size="extra-small" color="brand">active</Badge>}
                      </div>
                      <Text className={styles.rowMeta}>
                        {[
                          e.customer_name || null,
                          e.industry,
                          e.subscription_ids.length ? `${e.subscription_ids.length} subscription(s)` : null,
                          e.compliance_frameworks.length ? e.compliance_frameworks.join(", ") : null,
                        ].filter(Boolean).join(" · ") || "—"}
                      </Text>
                    </div>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={(ev) => { ev.stopPropagation(); startEdit(e); }}
                    >
                      Edit
                    </Button>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {formOpen && (
          <div className={styles.form}>
            <div className={styles.formHeader}>
              <Text weight="semibold">{editingId ? "Edit engagement" : "New engagement"}</Text>
              <Button appearance="subtle" onClick={() => { setCreating(false); setEditingId(null); }}>
                Cancel
              </Button>
            </div>
            <Field label="Name" required>
              <Input value={form.name} onChange={(_, d) => setForm({ ...form, name: d.value })} />
            </Field>
            <Field label="Customer">
              <Input value={form.customer_name} onChange={(_, d) => setForm({ ...form, customer_name: d.value })} />
            </Field>
            <Field label="Industry">
              <Input
                value={form.industry}
                placeholder="e.g. Financial Services, Healthcare"
                onChange={(_, d) => setForm({ ...form, industry: d.value })}
              />
            </Field>
            <Field label="Compliance frameworks (comma-separated)">
              <Input
                value={form.compliance_frameworks}
                placeholder="HIPAA, PCI-DSS, SOC 2"
                onChange={(_, d) => setForm({ ...form, compliance_frameworks: d.value })}
              />
            </Field>
            <Field
              label="Subscription IDs (comma-separated)"
              hint="Auto-scopes cost + scan queries to these subscriptions"
            >
              <Input
                value={form.subscription_ids}
                placeholder="00000000-0000-0000-0000-000000000000, ..."
                onChange={(_, d) => setForm({ ...form, subscription_ids: d.value })}
              />
            </Field>
            <Field label="Region preference">
              <Input
                value={form.region_preference}
                placeholder="eastus2"
                onChange={(_, d) => setForm({ ...form, region_preference: d.value })}
              />
            </Field>
            <Field label="Notes">
              <Textarea
                value={form.notes}
                rows={4}
                onChange={(_, d) => setForm({ ...form, notes: d.value })}
              />
            </Field>
            {editingId && (
              <>
                <Divider />
                <EngagementInventorySection engagementId={editingId} />
                <Divider />
                <EngagementReferencesSection engagementId={editingId} />
                <Divider />
                <EngagementArbSection engagementId={editingId} />
              </>
            )}
            <Divider />
            <div className={styles.actions}>
              {editingId && (
                <Button
                  appearance="subtle"
                  icon={<DeleteRegular />}
                  disabled={busy}
                  onClick={() => remove(editingId)}
                >
                  Delete
                </Button>
              )}
              <Button
                appearance="primary"
                icon={<SaveRegular />}
                disabled={busy}
                onClick={save}
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </DrawerBody>
    </Drawer>
  );
}
