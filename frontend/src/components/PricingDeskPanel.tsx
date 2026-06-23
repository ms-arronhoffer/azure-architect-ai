import { useCallback, useMemo, useState } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  makeStyles,
  tokens,
  Button,
  Text,
  Title3,
  Subtitle2,
  Caption1,
  Badge,
  Tag,
  Table,
  TableHeader,
  TableHeaderCell,
  TableRow,
  TableBody,
  TableCell,
  Tooltip,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  MoneyRegular,
  LightbulbRegular,
  GlobeRegular,
  TableSimpleRegular,
} from "@fluentui/react-icons";
import ChatPanel from "./ChatPanel";
import type {
  Mode,
  ChatMessage,
  WorkloadContext,
  PricedWorksheet,
  RegionAvailability,
} from "../types";
import { exportWorksheetToXlsx } from "../utils/pricingExport";

const useStyles = makeStyles({
  rightPane: {
    height: "100%",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    padding: tokens.spacingVerticalL,
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  resizeHandle: {
    width: "6px",
    backgroundColor: tokens.colorNeutralBackground3,
    cursor: "col-resize",
    transition: "background-color 0.15s ease",
    ":hover": { backgroundColor: tokens.colorBrandBackground },
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
  },
  totalCard: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  totalValue: { color: tokens.colorBrandForeground1 },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionTitle: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  lineHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalS,
  },
  tipList: { margin: 0, paddingLeft: tokens.spacingHorizontalL, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS },
  tipButton: { textAlign: "left", justifyContent: "flex-start" },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.spacingVerticalM,
    height: "100%",
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
    padding: tokens.spacingHorizontalXXL,
  },
  numeric: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  regionRow: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
  strike: { textDecoration: "line-through", color: tokens.colorNeutralForeground3 },
});

interface PricingDeskPanelProps {
  workloadContext?: WorkloadContext;
  onSave?: (id: string, mode: Mode, messages: ChatMessage[]) => void;
  initialMessages?: ChatMessage[];
  conversationId?: string;
}

function fmtMoney(v: number | null | undefined, currency: string): string {
  if (v === null || v === undefined) return "—";
  return `${currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtUnit(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function PricingDeskPanel({
  workloadContext,
  onSave,
  initialMessages,
  conversationId,
}: PricingDeskPanelProps) {
  const styles = useStyles();
  const [worksheet, setWorksheet] = useState<PricedWorksheet | null>(null);
  const [availability, setAvailability] = useState<RegionAvailability | null>(null);
  // A "pending send" pushed into the chat when a user clicks a recommendation
  // or a cheaper-region chip, so iteration loops back through the agent.
  const [pendingSend, setPendingSend] = useState<{ content: string; nonce: number } | null>(null);

  const handlePanelEvent = useCallback((event: { type: string; [key: string]: unknown }) => {
    if (event.type === "priced_worksheet") {
      setWorksheet(event.worksheet as PricedWorksheet);
    } else if (event.type === "region_availability") {
      setAvailability(event.availability as RegionAvailability);
    }
  }, []);

  const seed = useCallback((content: string) => {
    setPendingSend({ content, nonce: Date.now() });
  }, []);

  const currency = worksheet?.currency || "USD";
  const hasWorksheet = !!worksheet && worksheet.line_items.length > 0;

  const tips = worksheet?.optimization_tips ?? [];

  const reservationSavings = worksheet?.reservation_monthly_savings ?? 0;

  const exportDisabled = !hasWorksheet;

  const rightPane = useMemo(() => {
    if (!hasWorksheet && !availability) {
      return (
        <div className={styles.empty}>
          <MoneyRegular fontSize={40} />
          <Title3>Pricing Desk</Title3>
          <Text>
            Describe what you need priced — any Azure service, not just VMs. For example:
            <br />“Price 3× D8s_v5 in West Europe and 5 TB of hot blob storage.”
          </Text>
          <Text size={200}>
            The live worksheet builds here as you iterate. Ask for cheaper regions or
            reservations and the numbers update.
          </Text>
        </div>
      );
    }
    return (
      <div className={styles.rightPane}>
        <div className={styles.headerRow}>
          <div className={styles.sectionTitle}>
            <TableSimpleRegular />
            <Subtitle2>Pricing Worksheet</Subtitle2>
          </div>
          <Button
            appearance="primary"
            icon={<ArrowDownloadRegular />}
            disabled={exportDisabled}
            onClick={() => worksheet && exportWorksheetToXlsx(worksheet)}
          >
            Export to Excel
          </Button>
        </div>

        {hasWorksheet && worksheet && (
          <>
            <div className={styles.totalCard}>
              <Caption1>Estimated monthly total ({currency}, pay-as-you-go)</Caption1>
              <Title3 className={styles.totalValue}>
                {fmtMoney(worksheet.total_monthly_estimate, currency)}
              </Title3>
              {reservationSavings > 0 && (
                <Badge appearance="tint" color="success">
                  Reservations save {fmtMoney(reservationSavings, currency)}/mo
                </Badge>
              )}
              {worksheet.summary && (
                <Caption1>
                  {worksheet.summary.total_lines} line
                  {worksheet.summary.total_lines === 1 ? "" : "s"} ·{" "}
                  {worksheet.summary.catalog_matched} meter-aware
                  {worksheet.summary.unpriced_meters > 0
                    ? ` · ${worksheet.summary.unpriced_meters} unpriced meter(s)`
                    : ""}
                </Caption1>
              )}
            </div>

            {worksheet.line_items.map((line, li) => (
              <div className={styles.section} key={`${line.service}-${line.sku ?? ""}-${li}`}>
                <div className={styles.lineHeader}>
                  <div className={styles.sectionTitle}>
                    <Text weight="semibold">{line.display_name || line.service}</Text>
                    {line.sku && <Tag size="extra-small">{line.sku}</Tag>}
                    {line.region && <Tag size="extra-small" appearance="outline">{line.region}</Tag>}
                    {!line.catalog_matched && (
                      <Tooltip content="Priced via single-meter live lookup (not in the meter catalog)" relationship="label">
                        <Badge appearance="outline" color="warning" size="small">estimate</Badge>
                      </Tooltip>
                    )}
                  </div>
                  <div className={styles.numeric}>
                    {line.reservation_applied && line.original_monthly_estimate ? (
                      <>
                        <span className={styles.strike}>
                          {fmtMoney(line.original_monthly_estimate, currency)}
                        </span>{" "}
                        <Text weight="semibold">{fmtMoney(line.monthly_subtotal, currency)}</Text>
                      </>
                    ) : (
                      <Text weight="semibold">{fmtMoney(line.monthly_subtotal, currency)}</Text>
                    )}
                  </div>
                </div>
                <Table size="small" aria-label={`Meter breakdown for ${line.service}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Meter</TableHeaderCell>
                      <TableHeaderCell>Unit</TableHeaderCell>
                      <TableHeaderCell>Billable</TableHeaderCell>
                      <TableHeaderCell>Unit price</TableHeaderCell>
                      <TableHeaderCell>Monthly</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {line.meters.map((m, mi) => (
                      <TableRow key={`${line.service}-${m.dimension ?? mi}-${mi}`}>
                        <TableCell>
                          {m.label || m.meter_name || m.dimension || "—"}
                          {!m.priced && (
                            <>
                              {" "}
                              <Caption1>({m.note || "unpriced"})</Caption1>
                            </>
                          )}
                        </TableCell>
                        <TableCell>{m.unit_of_measure || m.unit || "—"}</TableCell>
                        <TableCell className={styles.numeric}>
                          {fmtUnit(m.billable_quantity ?? m.quantity)}
                        </TableCell>
                        <TableCell className={styles.numeric}>
                          {m.unit_price === null || m.unit_price === undefined
                            ? "—"
                            : fmtMoney(m.unit_price, m.currency || currency)}
                        </TableCell>
                        <TableCell className={styles.numeric}>
                          {fmtMoney(m.monthly_cost, m.currency || currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {line.sku && (
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<GlobeRegular />}
                    onClick={() =>
                      seed(`Check region availability and pricing for ${line.sku} (${line.service}).`)
                    }
                  >
                    Compare regions
                  </Button>
                )}
              </div>
            ))}

            {tips.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <LightbulbRegular />
                  <Subtitle2>Cost-savings recommendations</Subtitle2>
                </div>
                <ul className={styles.tipList}>
                  {tips.map((tip, i) => (
                    <li key={i}>
                      <Button
                        appearance="transparent"
                        size="small"
                        className={styles.tipButton}
                        onClick={() => seed(`Apply this recommendation and re-price: ${tip}`)}
                      >
                        {tip}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {worksheet.disclaimer && <Caption1>{worksheet.disclaimer}</Caption1>}
          </>
        )}

        {availability && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              <GlobeRegular />
              <Subtitle2>
                Region availability — {availability.requested_sku || availability.service}
              </Subtitle2>
            </div>
            <Caption1>
              {availability.available_count} of {availability.total_regions} regions available
              {availability.cheapest_region ? ` · cheapest: ${availability.cheapest_region}` : ""}
            </Caption1>
            <Table size="small" aria-label="Region availability">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Region</TableHeaderCell>
                  <TableHeaderCell>Available</TableHeaderCell>
                  <TableHeaderCell>Unit price</TableHeaderCell>
                  <TableHeaderCell></TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {availability.regions.map((r) => (
                  <TableRow key={r.region}>
                    <TableCell>
                      <div className={styles.regionRow}>
                        {r.region}
                        {r.cheapest && (
                          <Badge appearance="tint" color="success" size="small">cheapest</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{r.available ? "Yes" : "No"}</TableCell>
                    <TableCell className={styles.numeric}>
                      {r.available && r.unit_price !== null
                        ? `${fmtMoney(r.unit_price, r.currency)} / ${r.unit_of_measure || "unit"}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {r.available && (
                        <Button
                          size="small"
                          appearance="subtle"
                          onClick={() =>
                            seed(
                              `Re-price ${availability.requested_sku || availability.service} in ${r.region}.`
                            )
                          }
                        >
                          Re-price here
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  }, [styles, hasWorksheet, worksheet, availability, currency, tips, reservationSavings, exportDisabled, seed]);

  return (
    <PanelGroup orientation="horizontal" style={{ height: "100%", width: "100%" }}>
      <Panel defaultSize="48%" minSize="30%">
        <ChatPanel
          mode={"pricing-desk" as Mode}
          conversationId={conversationId}
          initialMessages={initialMessages}
          workloadContext={workloadContext}
          onSave={onSave}
          onPanelEvent={handlePanelEvent}
          pendingSend={pendingSend ?? undefined}
        />
      </Panel>
      <PanelResizeHandle className={styles.resizeHandle} />
      <Panel defaultSize="52%" minSize="30%">
        {rightPane}
      </Panel>
    </PanelGroup>
  );
}
