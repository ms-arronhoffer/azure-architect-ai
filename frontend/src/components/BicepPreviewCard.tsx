import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  MessageBar,
  MessageBarBody,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { BicepPreview } from "../types";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalS,
  },
  errors: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    fontSize: tokens.fontSizeBase200,
  },
});

interface Props {
  preview: BicepPreview | null | undefined;
}

export default function BicepPreviewCard({ preview }: Props) {
  const styles = useStyles();
  if (!preview) return null;

  if (!preview.valid) {
    return (
      <div className={styles.root}>
        <MessageBar intent="error">
          <MessageBarBody>
            Bicep failed to compile — {preview.errors.length} issue
            {preview.errors.length === 1 ? "" : "s"}.
          </MessageBarBody>
        </MessageBar>
        {preview.errors.length > 0 && (
          <ul className={styles.errors}>
            {preview.errors.map((e, i) => (
              <li key={i}>
                Line {e.line}:{e.col} — [{e.code}] {e.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <MessageBar intent="success">
        <MessageBarBody>
          Bicep compiled cleanly · {preview.total_count} resource
          {preview.total_count === 1 ? "" : "s"} will be deployed
        </MessageBarBody>
      </MessageBar>
      {preview.resources.length > 0 && (
        <Accordion collapsible>
          <AccordionItem value="resources">
            <AccordionHeader>
              <Text weight="semibold">Preview deployed resources ({preview.resources.length})</Text>
            </AccordionHeader>
            <AccordionPanel>
              <Table size="small">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Name</TableHeaderCell>
                    <TableHeaderCell>API Version</TableHeaderCell>
                    <TableHeaderCell>Location</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.resources.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.type}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{r.api_version}</TableCell>
                      <TableCell>{r.location ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}
