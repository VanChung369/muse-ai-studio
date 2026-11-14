import { useEffect, useRef, useState } from "react";

const COPIED_RESET_MS = 2000;

export function useCopyClipboard() {
  const [copied, setCopied] = useState(false);
  const [failedText, setFailedText] = useState<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  async function copy(text: string): Promise<boolean> {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setCopied(false);
    setFailedText(null);

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = undefined;
      }, COPIED_RESET_MS);
      return true;
    } catch {
      setFailedText(text);
      return false;
    }
  }

  function clearFallback() {
    setFailedText(null);
  }

  return { copied, failedText, copy, clearFallback };
}
