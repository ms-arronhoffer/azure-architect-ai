import {
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
  Button,
  Badge,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { BriefcaseRegular, AddRegular, EditRegular } from "@fluentui/react-icons";
import type { Engagement } from "../hooks/useEngagements";

const useStyles = makeStyles({
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    maxWidth: "220px",
  },
  triggerLabel: {
    fontSize: "12px",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  noneLabel: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  itemMeta: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    marginLeft: "8px",
  },
});

interface Props {
  engagements: Engagement[];
  active: Engagement | null;
  onSelect: (id: string | null) => void;
  onManage: () => void;
}

export default function EngagementSelector({ engagements, active, onSelect, onManage }: Props) {
  const styles = useStyles();
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          size="small"
          icon={<BriefcaseRegular />}
          title={active ? `Engagement: ${active.name}` : "No engagement scope"}
        >
          <span className={styles.trigger}>
            {active ? (
              <>
                <span className={styles.triggerLabel}>{active.name}</span>
                {active.subscription_ids.length > 0 && (
                  <Badge size="extra-small" appearance="tint" color="brand">
                    {active.subscription_ids.length} sub
                  </Badge>
                )}
              </>
            ) : (
              <span className={styles.noneLabel}>No engagement</span>
            )}
          </span>
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem onClick={() => onSelect(null)}>
            <span style={{ fontStyle: active ? "normal" : "italic" }}>None (global)</span>
          </MenuItem>
          {engagements.length > 0 && <MenuDivider />}
          {engagements.map((e) => (
            <MenuItem key={e.id} onClick={() => onSelect(e.id)}>
              <span style={{ fontWeight: e.id === active?.id ? 600 : 400 }}>{e.name}</span>
              {e.customer_name && <span className={styles.itemMeta}>· {e.customer_name}</span>}
            </MenuItem>
          ))}
          <MenuDivider />
          <MenuItem icon={<AddRegular />} onClick={onManage}>
            New engagement…
          </MenuItem>
          <MenuItem icon={<EditRegular />} onClick={onManage}>
            Manage engagements…
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
