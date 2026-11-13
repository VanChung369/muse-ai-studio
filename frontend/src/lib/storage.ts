import { STORAGE_EVENTS } from "@/constants/storage";

// Keep preferences usable when browser storage is blocked or full.
const memoryValues = new Map<string, string>();

export function readLocalStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  if (memoryValues.has(key)) return memoryValues.get(key)!;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
    memoryValues.delete(key);
  } catch {
    memoryValues.set(key, value);
  }

  // Native storage events only notify other documents.
  window.dispatchEvent(new Event(STORAGE_EVENTS.LOCAL_STORAGE_CHANGE));
}

export function deserializeStoredValue<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function subscribeToLocalStorage(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  function onStorage(event: StorageEvent) {
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }

    if (event.key === null) memoryValues.clear();
    else memoryValues.delete(event.key);
    onChange();
  }

  window.addEventListener("storage", onStorage);
  window.addEventListener(STORAGE_EVENTS.LOCAL_STORAGE_CHANGE, onChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(STORAGE_EVENTS.LOCAL_STORAGE_CHANGE, onChange);
  };
}
