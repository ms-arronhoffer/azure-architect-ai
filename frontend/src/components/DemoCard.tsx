import { useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardPreview,
  CardFooter,
  Badge,
  Button,
  Text,
  makeStyles,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import {
  Video24Regular,
  Code24Regular,
  Open24Regular,
  StarFilled,
  NewFilled,
  EditRegular,
  DeleteRegular,
} from "@fluentui/react-icons";
import type { Demo } from "../types";
import { DemoVideoModal } from "./DemoVideoModal";

function getVideoThumbnail(videoUrl: string | null): string | null {
  if (!videoUrl) return null;
  try {
    const url = new URL(videoUrl);
    if (url.hostname.includes("youtube.com") && url.searchParams.get("v")) {
      return `https://img.youtube.com/vi/${url.searchParams.get("v")}/hqdefault.jpg`;
    }
    if (url.hostname === "youtu.be") {
      return `https://img.youtube.com/vi/${url.pathname.slice(1)}/hqdefault.jpg`;
    }
  } catch {
    // ignore
  }
  return null;
}

const GRADIENT_COLORS = [
  "linear-gradient(135deg, #0078d4 0%, #106ebe 100%)",
  "linear-gradient(135deg, #8764b8 0%, #6b4fa0 100%)",
  "linear-gradient(135deg, #038387 0%, #005b5e 100%)",
  "linear-gradient(135deg, #c43501 0%, #a52c00 100%)",
  "linear-gradient(135deg, #107c10 0%, #0a5e0a 100%)",
];

function getGradient(id: string): string {
  const index = id.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return GRADIENT_COLORS[index % GRADIENT_COLORS.length];
}

function isNew(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 30 * 24 * 60 * 60 * 1000;
}

function formatSynced(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const days = Math.floor((Date.now() - parsed) / 86_400_000);
  if (days <= 0) return "Synced today";
  if (days === 1) return "Synced 1 day ago";
  return `Synced ${days} days ago`;
}

const useStyles = makeStyles({
  card: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    transition: "box-shadow 0.2s ease",
    ":hover": { boxShadow: tokens.shadow16 },
  },
  preview: {
    height: "160px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    userSelect: "none",
  },
  previewClickable: {
    cursor: "zoom-in",
    display: "block",
    width: "100%",
  },
  lightbox: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.85)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    cursor: "zoom-out",
  },
  lightboxImg: {
    maxWidth: "90vw",
    maxHeight: "90vh",
    objectFit: "contain",
    borderRadius: tokens.borderRadiusMedium,
  },
  previewImg: {
    width: "100%",
    height: "160px",
    objectFit: "cover",
  },
  headerBadges: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    marginBottom: tokens.spacingVerticalXS,
  },
  description: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    display: "-webkit-box",
    WebkitLineClamp: "3",
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  descriptionExpanded: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  showMoreBtn: {
    fontSize: tokens.fontSizeBase200,
    minWidth: 0,
    padding: 0,
    height: "auto",
  },
  footer: {
    marginTop: "auto",
    display: "flex",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
    alignItems: "center",
  },
  footerSpacer: { flex: 1 },
  syncedLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    marginTop: tokens.spacingVerticalXS,
  },
});

interface DemoCardProps {
  demo: Demo;
  onEdit?: (demo: Demo) => void;
  onDelete?: (demo: Demo) => void;
}

export function DemoCard({ demo, onEdit, onDelete }: DemoCardProps) {
  const styles = useStyles();
  const [modalOpen, setModalOpen] = useState(false);
  const [imgExpanded, setImgExpanded] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const previewImg = demo.thumbnail_url ?? getVideoThumbnail(demo.video_url ?? null);
  const isCurated = Boolean(demo.source && demo.source !== "custom");
  const syncedLabel = demo.source === "microsoft_official" ? formatSynced(demo.last_synced_at) : null;

  useEffect(() => {
    if (!imgExpanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setImgExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imgExpanded]);

  return (
    <>
      <Card className={styles.card}>
        <CardPreview>
          <div
            className={previewImg ? styles.previewClickable : undefined}
            onClick={previewImg ? () => setImgExpanded(true) : undefined}
            role={previewImg ? "button" : undefined}
            aria-label={previewImg ? `Expand ${demo.title} thumbnail` : undefined}
            tabIndex={previewImg ? 0 : undefined}
            onKeyDown={previewImg ? (e) => e.key === "Enter" && setImgExpanded(true) : undefined}
          >
            {previewImg ? (
              <img className={styles.previewImg} src={previewImg} alt={demo.title} />
            ) : (
              <div className={styles.preview} style={{ background: getGradient(demo.id) }} />
            )}
          </div>
        </CardPreview>

        <CardHeader
          header={
            <div>
              <div className={styles.headerBadges}>
                {demo.featured && (
                  <Tooltip content="Featured" relationship="label">
                    <Badge appearance="filled" color="brand" icon={<StarFilled />}>
                      Featured
                    </Badge>
                  </Tooltip>
                )}
                {demo.source === "microsoft_official" && (
                  <Badge appearance="filled" color="informative">
                    MS Official
                  </Badge>
                )}
                {demo.source === "community" && (
                  <Badge appearance="outline" color="informative">
                    Community
                  </Badge>
                )}
                {demo.source === "custom" && (
                  <Badge appearance="outline" color="success">
                    Custom
                  </Badge>
                )}
                {isNew(demo.created_at) && (
                  <Badge appearance="filled" color="success" icon={<NewFilled />}>
                    New
                  </Badge>
                )}
                {demo.tags.slice(0, 4).map((tag) => (
                  <Badge key={tag} appearance="outline" color="informative">
                    {tag}
                  </Badge>
                ))}
              </div>
              <Text weight="semibold" size={400}>{demo.title}</Text>
            </div>
          }
          description={
            <div>
              <Text className={descExpanded ? styles.descriptionExpanded : styles.description}>
                {demo.description}
              </Text>
              {demo.description && demo.description.length > 140 && (
                <Button
                  appearance="transparent"
                  className={styles.showMoreBtn}
                  onClick={() => setDescExpanded(!descExpanded)}
                >
                  {descExpanded ? "Show less" : "Show more"}
                </Button>
              )}
              {syncedLabel && (
                <div className={styles.syncedLabel}>{syncedLabel}</div>
              )}
            </div>
          }
        />

        <CardFooter className={styles.footer}>
          {demo.video_url && (
            <Button
              appearance="primary"
              icon={<Video24Regular />}
              onClick={() => setModalOpen(true)}
            >
              Watch
            </Button>
          )}
          {demo.live_url && (
            <Button
              appearance={demo.video_url ? "outline" : "primary"}
              icon={<Open24Regular />}
              as="a"
              href={demo.live_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Live Demo
            </Button>
          )}
          {demo.repo_url && (
            <Button
              appearance="outline"
              icon={<Code24Regular />}
              as="a"
              href={demo.repo_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Repo
            </Button>
          )}
          <div className={styles.footerSpacer} />
          {onEdit && (
            <Tooltip
              content={isCurated ? "Curated entry — only `featured` is editable" : "Edit"}
              relationship="label"
            >
              <Button
                appearance="subtle"
                icon={<EditRegular />}
                aria-label="Edit demo"
                onClick={() => onEdit(demo)}
              />
            </Tooltip>
          )}
          {onDelete && !isCurated && (
            <Tooltip content="Delete" relationship="label">
              <Button
                appearance="subtle"
                icon={<DeleteRegular />}
                aria-label="Delete demo"
                onClick={() => onDelete(demo)}
              />
            </Tooltip>
          )}
        </CardFooter>
      </Card>

      <DemoVideoModal
        videoUrl={demo.video_url}
        title={demo.title}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />

      {imgExpanded && previewImg && (
        <div className={styles.lightbox} onClick={() => setImgExpanded(false)}>
          <img className={styles.lightboxImg} src={previewImg} alt={demo.title} />
        </div>
      )}
    </>
  );
}
