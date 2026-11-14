import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api";
import { requestJson } from "@/lib/http";
import { PROJECT_STATUSES } from "../constants";

const seconds = z.number().nonnegative();

export const CAPTION_SIZES = ["small", "medium", "large", "xlarge"] as const;
export const CAPTION_POSITIONS = ["bottom", "middle", "top"] as const;
// Fonts the server asks for by name; one it does not have falls back to its
// default.
export const CAPTION_FONTS = [
  "Arial",
  "Tahoma",
  "Verdana",
  "Times New Roman",
  "Georgia",
  "Courier New",
] as const;
// A look laid over a clip.
export const CLIP_EFFECTS = [
  "none",
  "mono",
  "sepia",
  "warm",
  "cool",
  "vivid",
  "vintage",
  "blur",
  "vignette",
] as const;
// A slow push in or pull out over the length of a clip.
export const CLIP_ZOOMS = ["none", "in", "out"] as const;
export const TITLE_POSITIONS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;
export const LOGO_CORNERS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;
export const OUTPUT_ASPECTS = ["source", "16:9", "9:16", "1:1"] as const;
export const OUTPUT_FITS = ["contain", "cover"] as const;
// Frame height in pixels; 0 keeps the height of the scenes.
export const OUTPUT_HEIGHTS = [0, 480, 720, 1080] as const;
export const OUTPUT_QUALITIES = ["high", "medium", "small"] as const;

// How captions are drawn into the picture.
const captionStyleSchema = z.object({
  size: z.enum(CAPTION_SIZES),
  // Letters and their outline, as #RRGGBB.
  color: z.string(),
  outline: z.string(),
  position: z.enum(CAPTION_POSITIONS),
  bold: z.boolean(),
  // A dark box behind the words instead of an outline around them.
  box: z.boolean(),
  font: z.enum(CAPTION_FONTS),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

// Words placed on the picture for a while: a title, a name, a call to action.
const titleSchema = z.object({
  // Seconds into the film.
  start: seconds,
  end: seconds,
  text: z.string(),
  size: z.enum(CAPTION_SIZES),
  color: z.string(),
  position: z.enum(TITLE_POSITIONS),
  bold: z.boolean(),
  box: z.boolean(),
});
export type TimelineTitle = z.infer<typeof titleSchema>;

// A picture kept in a corner for the whole film.
const logoSchema = z.object({
  mediaId: z.string(),
  corner: z.enum(LOGO_CORNERS),
  // Width as a percentage of the frame's width.
  size: z.number(),
  opacity: z.number(),
  url: z.string(),
});
export type TimelineLogo = z.infer<typeof logoSchema>;

// The shape and weight of the merged file.
const outputSchema = z.object({
  // "source" keeps the shape of the scenes.
  aspect: z.enum(OUTPUT_ASPECTS),
  // In another shape, show the whole picture (bars) or fill the frame (crop).
  fit: z.enum(OUTPUT_FITS),
  height: z.union(OUTPUT_HEIGHTS.map((value) => z.literal(value))),
  quality: z.enum(OUTPUT_QUALITIES),
});
export type TimelineOutput = z.infer<typeof outputSchema>;

export const projectTimelineSchema = z.object({
  projectId: z.string(),
  status: z.enum(PROJECT_STATUSES),
  // The timeline can change once the film is finished and not being merged.
  editable: z.boolean(),
  // The film's picture in play order: scenes that have a clip (a scene cut
  // in two appears twice), and videos and pictures the user added.
  items: z.array(
    z.object({
      // Names this entry while it is edited; stable across saves.
      key: z.string(),
      kind: z.enum(["scene", "video", "image"]),
      scene: z.number().int().min(1).nullable(),
      mediaId: z.string().nullable(),
      title: z.string(),
      // Length of the clip; for a picture, the longest it may be shown.
      clipSeconds: seconds,
      // The part of the clip that is kept, in seconds into it. For a
      // picture, `end` is how long it is shown.
      start: seconds,
      end: seconds,
      // False leaves the piece out of the film.
      enabled: z.boolean(),
      // 2 plays twice as fast, so the piece takes half as long in the film.
      speed: z.number().positive(),
      effect: z.enum(CLIP_EFFECTS),
      zoom: z.enum(CLIP_ZOOMS),
      // Mirrored left to right.
      flip: z.boolean(),
      // Seconds the piece takes to come up from black, and to go to black.
      fadeIn: seconds,
      fadeOut: seconds,
      videoUrl: z.string().nullable(),
      thumbnailUrl: z.string().nullable(),
    }),
  ),
  // Audio laid over the film.
  audio: z.array(
    z.object({
      key: z.string(),
      mediaId: z.string(),
      name: z.string(),
      clipSeconds: seconds,
      // Where in the film it starts.
      offset: seconds,
      // The part of the file that is used.
      start: seconds,
      end: seconds,
      volume: seconds,
      // Repeat until the film ends.
      loop: z.boolean(),
      fadeIn: seconds,
      fadeOut: seconds,
      url: z.string(),
      // A drawing of the file's sound, to show on its track.
      waveformUrl: z.string(),
    }),
  ),
  // Volume of the sound the clips came with (1 = unchanged).
  volume: seconds,
  // Lower the added audio while the clips' own sound is heard.
  duck: z.boolean(),
  captions: z.array(
    // Seconds into the film.
    z.object({ start: seconds, end: seconds, text: z.string() }),
  ),
  // Draw the captions into the picture when merging.
  burnCaptions: z.boolean(),
  captionStyle: captionStyleSchema,
  titles: z.array(titleSchema),
  logo: logoSchema.nullable(),
  output: outputSchema,
  // False when the server's FFmpeg cannot draw captions or titles.
  canBurnCaptions: z.boolean(),
  totalSeconds: seconds,
});

export const timelineKey = (id: string) =>
  ["projects", "timeline", id] as const;

const timelinePath = (id: string) =>
  `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(id)}/timeline`;

export async function fetchTimeline(id: string, signal?: AbortSignal) {
  return projectTimelineSchema.parse(
    await requestJson(timelinePath(id), { signal }),
  );
}

type Look = {
  effect: (typeof CLIP_EFFECTS)[number];
  zoom: (typeof CLIP_ZOOMS)[number];
  flip: boolean;
  fadeIn: number;
  fadeOut: number;
};
type Cut = Look & {
  key: string;
  start: number;
  end: number;
  enabled: boolean;
  speed: number;
};

/** What PUT /timeline takes: the whole edit, replacing the saved one. */
export type TimelinePayload = {
  items: (Cut & ({ scene: number } | { mediaId: string }))[];
  audio: {
    mediaId: string;
    key: string;
    offset: number;
    start: number;
    end: number;
    volume: number;
    loop: boolean;
    fadeIn: number;
    fadeOut: number;
  }[];
  volume: number;
  duck: boolean;
  captions: { start: number; end: number; text: string }[];
  burnCaptions: boolean;
  captionStyle: CaptionStyle;
  titles: TimelineTitle[];
  logo: Omit<TimelineLogo, "url"> | null;
  output: TimelineOutput;
};

export async function saveTimeline(values: { id: string } & TimelinePayload) {
  const { id, ...edit } = values;
  return projectTimelineSchema.parse(
    await requestJson(timelinePath(id), {
      method: "PUT",
      body: JSON.stringify(edit),
    }),
  );
}

const previewSchema = z.object({ url: z.string(), seconds });

/**
 * Builds a small, quick version of the film this edit would make, without
 * saving the edit, and returns where to watch it.
 */
export async function previewTimeline(
  values: { id: string } & TimelinePayload,
) {
  const { id, ...edit } = values;
  return previewSchema.parse(
    await requestJson(`${timelinePath(id)}/preview`, {
      method: "POST",
      body: JSON.stringify(edit),
    }),
  );
}

const coverPath = (id: string) =>
  `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(id)}/cover`;

/** Uses the film's frame at `seconds` as the project's cover. */
export async function setCover(values: { id: string; seconds: number }) {
  await requestJson(coverPath(values.id), {
    method: "POST",
    body: JSON.stringify({ seconds: values.seconds }),
  });
}

/** Goes back to the cover picked automatically. */
export async function clearCover(id: string) {
  await requestJson(coverPath(id), { method: "DELETE" });
}
