import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api";
import { requestJson } from "@/lib/http";
import { PROJECT_STATUSES } from "../constants";

const seconds = z.number().nonnegative();

export const CAPTION_SIZES = ["small", "medium", "large", "xlarge"] as const;
export const CAPTION_POSITIONS = ["bottom", "middle", "top"] as const;

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
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const projectTimelineSchema = z.object({
  projectId: z.string(),
  status: z.enum(PROJECT_STATUSES),
  // The timeline can change once the film is finished and not being merged.
  editable: z.boolean(),
  // The film's picture in play order: scenes that have a clip, and videos
  // and pictures the user added.
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
      url: z.string(),
      // A drawing of the file's sound, to show on its track.
      waveformUrl: z.string(),
    }),
  ),
  // Volume of the sound the clips came with (1 = unchanged).
  volume: seconds,
  captions: z.array(
    // Seconds into the film.
    z.object({ start: seconds, end: seconds, text: z.string() }),
  ),
  // Draw the captions into the picture when merging.
  burnCaptions: z.boolean(),
  captionStyle: captionStyleSchema,
  // False when the server's FFmpeg cannot draw captions.
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

type Cut = { start: number; end: number; enabled: boolean; speed: number };

/** What PUT /timeline takes: the whole edit, replacing the saved one. */
export type TimelinePayload = {
  items: (Cut & ({ scene: number } | { mediaId: string; key: string }))[];
  audio: {
    mediaId: string;
    key: string;
    offset: number;
    start: number;
    end: number;
    volume: number;
    loop: boolean;
  }[];
  volume: number;
  captions: { start: number; end: number; text: string }[];
    burnCaptions: boolean;
  captionStyle: CaptionStyle;
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
