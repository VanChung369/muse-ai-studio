import type { Project } from "../types";

const referenceTime = Date.now();
const minutesAgo = (minutes: number) =>
  new Date(referenceTime - minutes * 60000).toISOString();

// Fictional project content. It stays separate from interface translations,
// just as a user's project names and prompts would in the real API response.
const coffeeScenes = [
  {
    number: 1,
    title: "Sunrise over Cầu Đất",
    prompt:
      "A slow aerial shot over misty coffee hills at sunrise, soft golden light and layers of morning fog.",
  },
  {
    number: 2,
    title: "Into the coffee hills",
    prompt:
      "An elderly farmer walks between rows of coffee plants, carrying a woven basket in the morning light.",
  },
  {
    number: 3,
    title: "Ripe red cherries",
    prompt:
      "A close-up of weathered hands picking ripe coffee cherries, with droplets of dew on green leaves.",
  },
  {
    number: 4,
    title: "Roasting by hand",
    prompt:
      "Coffee beans tumble in a cast-iron pan above a wood fire, with a thin ribbon of smoke.",
  },
  {
    number: 5,
    title: "The first slow drip",
    prompt:
      "Dark coffee drips through a Vietnamese phin filter into a glass, steam rising beside a wooden window.",
  },
  {
    number: 6,
    title: "A cup at sunset",
    prompt:
      "The farmer smiles and lifts a cup of coffee. The camera pulls back to reveal the hills at sunset.",
  },
];

export const DEMO_PROJECTS: Project[] = [
  {
    id: "demo-coffee",
    name: "Đà Lạt Coffee Journey",
    status: "ready",
    aspectRatio: "16:9",
    durationSeconds: 60,
    sceneCount: 6,
    completedScenes: 0,
    updatedAt: minutesAgo(12),
    coverTone: "coffee",
    idea: "Follow a coffee cherry from the misty hills of Cầu Đất to the first cup of coffee at sunset. A warm, cinematic story told through a farmer's hands.",
    scenes: coffeeScenes,
  },
  {
    id: "demo-hoi-an",
    name: "Hội An After Dark",
    status: "rendering",
    aspectRatio: "16:9",
    durationSeconds: 60,
    sceneCount: 6,
    completedScenes: 2,
    currentScene: 3,
    updatedAt: minutesAgo(3),
    coverTone: "night",
    idea: "A quiet walk along the lantern-lit river, from the bustle of the night market to the last boat crossing.",
    scenes: [],
  },
  {
    id: "demo-tea",
    name: "Cầu Đất Oolong — Product Story",
    status: "failed",
    aspectRatio: "9:16",
    durationSeconds: 40,
    sceneCount: 4,
    completedScenes: 2,
    currentScene: 3,
    updatedAt: minutesAgo(1440),
    coverTone: "tea",
    errorCode: "sessionExpired",
    idea: "An intimate portrait of oolong tea: fresh leaves, careful preparation, and a steaming cup beside the garden.",
    scenes: [],
  },
  {
    id: "demo-studio",
    name: "Studio Opening Teaser",
    status: "completed",
    aspectRatio: "9:16",
    durationSeconds: 30,
    sceneCount: 3,
    completedScenes: 3,
    updatedAt: minutesAgo(2880),
    coverTone: "studio",
    idea: "A short invitation to a new creative space, following light as it moves across the studio.",
    scenes: [],
  },
  {
    id: "demo-space",
    name: "The Little Cat Astronaut",
    status: "completed",
    aspectRatio: "1:1",
    durationSeconds: 50,
    sceneCount: 5,
    completedScenes: 5,
    updatedAt: minutesAgo(7200),
    coverTone: "space",
    idea: "An orange cat explores a space station, chases a floating treat, and falls asleep beside a window looking down at Earth.",
    scenes: [],
  },
  {
    id: "demo-rice",
    name: "Mù Cang Chải Harvest",
    status: "cancelled",
    aspectRatio: "16:9",
    durationSeconds: 70,
    sceneCount: 7,
    completedScenes: 4,
    currentScene: 5,
    updatedAt: minutesAgo(14400),
    coverTone: "landscape",
    idea: "A day among the golden rice terraces, following the harvest from first light to the walk home.",
    scenes: [],
  },
];
