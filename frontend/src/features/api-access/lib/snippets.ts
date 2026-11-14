import { V1_ENDPOINTS } from "../constants";
import type { PlaygroundRequestConfig, QuickstartLanguage } from "../types";

export function buildQuickstartSnippet(
  language: QuickstartLanguage,
  baseUrl: string,
): string {
  if (language === "curl") {
    return `curl -X POST "${baseUrl}/images/generations" \\
  -H "Authorization: Bearer $MUSE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "muse-image",
    "prompt": "A glass of iced coffee on a window sill",
    "n": 1,
    "size": "1024x1024"
  }'`;
  }

  if (language === "python") {
    return `import os
from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key=os.environ["MUSE_API_KEY"],
)

result = client.images.generate(
    model="muse-image",
    prompt="A glass of iced coffee on a window sill",
    n=1,
    size="1024x1024",
)
print(result.data[0].url)`;
  }

  return `const response = await fetch("${baseUrl}/images/generations", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.MUSE_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "muse-image",
    prompt: "A glass of iced coffee on a window sill",
    n: 1,
    size: "1024x1024",
  }),
});

const data = await response.json();
console.log(data.data[0].url);`;
}

export function buildPlaygroundRequest(config: PlaygroundRequestConfig): {
  method: "GET" | "POST";
  path: string;
  body: Record<string, unknown> | null;
} {
  switch (config.endpoint) {
    case "images":
      return {
        method: "POST",
        path: V1_ENDPOINTS.IMAGES,
        body: {
          model: "muse-image",
          prompt: config.prompt.trim(),
          n: config.n,
          size: config.size,
          response_format: config.responseFormat,
        },
      };
    case "videos":
      return {
        method: "POST",
        path: V1_ENDPOINTS.VIDEOS,
        body: {
          model: "muse-video",
          prompt: config.prompt.trim(),
          aspect_ratio: config.aspectRatio,
        },
      };
    case "chat":
      return {
        method: "POST",
        path: V1_ENDPOINTS.CHAT,
        body: {
          model: config.model,
          messages: [{ role: "user", content: config.prompt.trim() }],
          stream: config.stream,
        },
      };
    case "models":
      return {
        method: "GET",
        path: V1_ENDPOINTS.MODELS,
        body: null,
      };
  }
}

function escapeSingleQuotesForShell(text: string): string {
  return text.replace(/'/g, "'\\''");
}

export function buildPlaygroundCurl(
  origin: string,
  config: PlaygroundRequestConfig,
): string {
  const { method, path, body } = buildPlaygroundRequest(config);
  const url = `${origin}${path}`;

  if (method === "GET" || body === null) {
    return `curl "${url}" \\
  -H "Authorization: Bearer $MUSE_API_KEY"`;
  }

  const streamFlag =
    config.endpoint === "chat" && config.stream ? " -N" : "";
  const json = escapeSingleQuotesForShell(JSON.stringify(body, null, 2));

  return `curl -X POST${streamFlag} "${url}" \\
  -H "Authorization: Bearer $MUSE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
}
