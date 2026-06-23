import { useCallback, useMemo, useRef, useState } from "react";
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
  Spinner,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ArrowUploadRegular,
  MoneyRegular,
  LightbulbRegular,
  GlobeRegular,
  TableSimpleRegular,
  CheckmarkCircleRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import ChatPanel from "./ChatPanel";
import type {
  Mode,
  ChatMessage,
  WorkloadContext,
  PricedWorksheet,
  PricedLine,
  RegionAvailability,
  SseEvent,
} from "../types";
import { exportWorksheetToXlsx } from "../utils/pricingExport";
import { useSSE } from "../hooks/useSSE";

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
  assumptions: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground3,
  },
  completenessRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXXS} 0`,
  },
  headerActions: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
  hiddenInput: { display: "none" },
  citation: { color: tokens.colorNeutralForeground3 },
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

type BadgeColor = "success" | "warning" | "danger" | "informative";

function confidenceColor(label?: string): BadgeColor {
  if (label === "high") return "success";
  if (label === "medium") return "informative";
  if (label === "low") return "warning";
  return "danger";
}

function lineCitation(line: PricedLine): string | null {
  const cited = line.meters?.find((m) => m.citation?.meter_id || m.meter_id);
  if (!cited) return null;
  const c = cited.citation;
  const parts = [c?.meter_name || cited.meter_name, c?.sku_name, c?.region].filter(Boolean);
  return parts.length ? `Azure Retail meter: ${parts.join(" · ")}` : null;
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

  // Price-a-drawing: stream the unified /cost/price-architecture endpoint with
  // an uploaded image / draw.io XML / text file straight into the worksheet.
  const { stream, isStreaming } = useSSE();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleStreamEvent = useCallback((event: SseEvent) => {
    if (event.type === "priced_worksheet") {
      setWorksheet(event.worksheet);
      setStatusMsg(null);
    } else if (event.type === "status") {
      setStatusMsg(event.message);
    } else if (event.type === "error") {
      setStreamError(event.message);
      setStatusMsg(null);
    }
  }, []);

  const priceFile = useCallback(
    async (file: File) => {
      setStreamError(null);
      setStatusMsg("Reading the architecture…");
      try {
        if (file.type.startsWith("image/")) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("Could not read the image file."));
            reader.readAsDataURL(file);
          });
          await stream("/cost/price-architecture", { image_data_url: dataUrl }, handleStreamEvent);
        } else {
          const text = await file.text();
          const isDrawio = text.includes("<mxfile") || text.includes("<mxGraphModel");
          const body = isDrawio ? { drawio_xml: text } : { text };
          await stream("/cost/price-architecture", body, handleStreamEvent);
        }
      } catch (err) {
        setStreamError(err instanceof Error ? err.message : "Failed to price the drawing.");
        setStatusMsg(null);
      }
    },
    [stream, handleStreamEvent],
  );

  const onFilePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-uploading the same file
      if (file) void priceFile(file);
    },
    [priceFile],
  );

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
    const uploadBar = (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,.xml,.drawio,.txt,.md"
          className={styles.hiddenInput}
          onChange={onFilePicked}
        />
        <Button
          appearance="secondary"
          icon={isStreaming ? <Spinner size="tiny" /> : <ArrowUploadRegular />}
          disabled={isStreaming}
          onClick={() => fileInputRef.current?.click()}
        >
          {isStreaming ? "Pricing…" : "Price a drawing"}
        </Button>
      </>
    );
    const banners = (
      <>
        {statusMsg && (
          <MessageBar intent="info">
            <MessageBarBody>{statusMsg}</MessageBarBody>
          </MessageBar>
        )}
        {streamError && (
          <MessageBar intent="error">
            <MessageBarBody>{streamError}</MessageBarBody>
          </MessageBar>
        )}
      </>
    );

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
            Or drop in an architecture: upload a diagram image or a draw.io file and
            every priceable node is enumerated, defaulted, and costed — with assumptions,
            confidence, and a completeness report.
          </Text>
          {uploadBar}
          {banners}
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
          <div className={styles.headerActions}>
            {uploadBar}
            <Button
              appearance="primary"
              icon={<ArrowDownloadRegular />}
              disabled={exportDisabled}
              onClick={() => worksheet && exportWorksheetToXlsx(worksheet)}
            >
              Export to Excel
            </Button>
          </div>
        </div>

        {banners}
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

            {worksheet.completeness && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  {worksheet.completeness.fully_accounted ? (
                    <CheckmarkCircleRegular />
                  ) : (
                    <WarningRegular />
                  )}
                  <Subtitle2>Coverage</Subtitle2>
                </div>
                <Caption1>
                  {worksheet.completeness.priced} of {worksheet.completeness.priceable} priceable
                  component(s) priced · {worksheet.extraction?.component_count ??
                    worksheet.completeness.components_found}{" "}
                  found{worksheet.extraction?.source ? ` (${worksheet.extraction.source})` : ""}.
                </Caption1>
                {worksheet.completeness.not_billable.map((nb, i) => (
                  <div className={styles.completenessRow} key={`nb-${i}`}>
                    <Badge appearance="tint" color="informative" size="small">
                      not billable
                    </Badge>
                    <Caption1>
                      {nb.name} — {nb.reason}
                    </Caption1>
                  </div>
                ))}
                {worksheet.completeness.unpriced.map((up, i) => (
                  <div className={styles.completenessRow} key={`up-${i}`}>
                    <Badge appearance="tint" color="warning" size="small">
                      unpriced
                    </Badge>
                    <Caption1>
                      {up.name} — {up.reason}
                    </Caption1>
                  </div>
                ))}
                {worksheet.completeness.unknown.map((uk, i) => (
                  <div className={styles.completenessRow} key={`uk-${i}`}>
                    <Badge appearance="tint" color="danger" size="small">
                      unrecognized
                    </Badge>
                    <Caption1>
                      {uk.name} — {uk.reason}
                    </Caption1>
                  </div>
                ))}
              </div>
            )}

            {worksheet.line_items.map((line, li) => (
              <div className={styles.section} key={`${line.service}-${line.sku ?? ""}-${li}`}>
                <div className={styles.lineHeader}>
                  <div className={styles.sectionTitle}>
                    <Text weight="semibold">{line.display_name || line.service}</Text>
                    {line.sku && <Tag size="extra-small">{line.sku}</Tag>}
                    {line.region && <Tag size="extra-small" appearance="outline">{line.region}</Tag>}
                    {line.confidence_label && (
                      <Tooltip
                        content={lineCitation(line) || "Match confidence against the Azure Retail catalog"}
                        relationship="label"
                      >
                        <Badge
                          appearance="tint"
                          color={confidenceColor(line.confidence_label)}
                          size="small"
                        >
                          {line.confidence_label} confidence
                        </Badge>
                      </Tooltip>
                    )}
                    {!line.catalog_matched && (
                      <Tooltip
                        content={
                          line.discovered
                            ? "Priced via dynamic meter discovery from the live Retail API"
                            : "Priced via single-meter live lookup (not in the meter catalog)"
                        }
                        relationship="label"
                      >
                        <Badge appearance="outline" color="warning" size="small">
                          {line.discovered ? "discovered" : "estimate"}
                        </Badge>
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
                {line.assumptions && line.assumptions.length > 0 && (
                  <ul className={styles.assumptions}>
                    {line.assumptions.map((a, ai) => (
                      <li key={ai}>
                        <Caption1>assumption: {a}</Caption1>
                      </li>
                    ))}
                  </ul>
                )}
                {lineCitation(line) && (
                  <Caption1 className={styles.citation}>{lineCitation(line)}</Caption1>
                )}
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
  }, [styles, hasWorksheet, worksheet, availability, currency, tips, reservationSavings, exportDisabled, seed, isStreaming, statusMsg, streamError, onFilePicked]);

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
