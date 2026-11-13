import { useSyncExternalStore, type SetStateAction } from "react";

import {
  deserializeStoredValue,
  readLocalStorage,
  subscribeToLocalStorage,
  writeLocalStorage,
} from "@/lib/storage";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const snapshot = useSyncExternalStore(
    subscribeToLocalStorage,
    () => readLocalStorage(key),
    () => null,
  );
  const value = deserializeStoredValue(snapshot, initialValue);

  function setValue(update: SetStateAction<T>): void {
    const currentValue = deserializeStoredValue(readLocalStorage(key), initialValue);
    const nextValue = typeof update === "function"
      ? (update as (previous: T) => T)(currentValue)
      : update;
    const serialized = JSON.stringify(nextValue);

    if (serialized === undefined) {
      throw new TypeError("Local storage values must be JSON-serializable.");
    }

    writeLocalStorage(key, serialized);
  }

  return [value, setValue] as const;
}
