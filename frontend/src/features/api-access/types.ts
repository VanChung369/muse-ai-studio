import type { z } from "zod";

import type {
  CHAT_MODELS,
  IMAGE_COUNTS,
  IMAGE_RESPONSE_FORMATS,
  IMAGE_SHAPES,
  PLAYGROUND_ENDPOINTS,
  QUICKSTART_LANGUAGES,
  VIDEO_ASPECT_RATIOS,
} from "./constants";
import type {
  apiKeyCreatedSchema,
  apiKeySchema,
  createApiKeyFormSchema,
  videoGenerationSchema,
} from "./schemas";

export type ApiKey = z.infer<typeof apiKeySchema>;
export type ApiKeyCreated = z.infer<typeof apiKeyCreatedSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeyFormSchema>;
export type VideoGeneration = z.infer<typeof videoGenerationSchema>;

export type QuickstartLanguage = (typeof QUICKSTART_LANGUAGES)[number];
export type PlaygroundEndpointId = (typeof PLAYGROUND_ENDPOINTS)[number];
export type ImageShape = (typeof IMAGE_SHAPES)[number];
export type ImageCount = (typeof IMAGE_COUNTS)[number];
export type ImageResponseFormat = (typeof IMAGE_RESPONSE_FORMATS)[number];
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number]["ratio"];
export type ChatModel = (typeof CHAT_MODELS)[number];

export type PlaygroundRequestConfig =
  | {
      endpoint: "images";
      prompt: string;
      n: ImageCount;
      size: ImageShape["size"];
      responseFormat: ImageResponseFormat;
    }
  | {
      endpoint: "videos";
      prompt: string;
      aspectRatio: VideoAspectRatio;
    }
  | {
      endpoint: "chat";
      model: ChatModel;
      prompt: string;
      stream: boolean;
    }
  | {
      endpoint: "models";
    };

export type OpenAiErrorInfo = {
  message: string;
  type: string;
  code: string | null;
};

export type PlaygroundError =
  | {
      kind: "openai";
      status: number;
      info: OpenAiErrorInfo;
      taskId?: string | null;
    }
  | { kind: "http"; status: number; message: string; taskId?: string | null }
  | { kind: "network" }
  | { kind: "reveal"; source: unknown };

export type ChatSegment =
  | { type: "text"; text: string }
  | { type: "image"; alt: string; url: string }
  | { type: "video"; url: string };
