import { type ProjectMedia, projectMediaSchema } from "../api/media";

// What a card dragged out of the media library carries, named by where it
// may land: a browser only reveals these names (not the data) while the card
// is still in the air.
export const DRAG_CLIP = "application/x-muse-clip";
export const DRAG_AUDIO = "application/x-muse-audio";

export function dragType(media: ProjectMedia) {
  return media.kind === "audio" ? DRAG_AUDIO : DRAG_CLIP;
}

export function startMediaDrag(event: React.DragEvent, media: ProjectMedia) {
  event.dataTransfer.setData(dragType(media), JSON.stringify(media));
  event.dataTransfer.effectAllowed = "copy";
}

export function carriesMedia(event: React.DragEvent, type: string) {
  return event.dataTransfer.types.includes(type);
}

/** The library file dropped here, if it is one of this kind. */
export function droppedMedia(
  event: React.DragEvent,
  type: string,
): ProjectMedia | null {
  try {
    const parsed = projectMediaSchema.safeParse(
      JSON.parse(event.dataTransfer.getData(type)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
