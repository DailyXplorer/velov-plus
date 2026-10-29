import { useEffect, useState, useSyncExternalStore } from "react";
import { OPERATIONS_KEY, accountDigest, createOperations } from "@/lib/operations";

export const operations = createOperations(() => typeof localStorage === "undefined" ? null : localStorage);

if (typeof window !== "undefined") window.addEventListener("storage", (event) => { if (event.key === OPERATIONS_KEY || event.key === null) operations.changed(); });

function useVersion() {
  return useSyncExternalStore(operations.subscribe, operations.version, () => 0);
}

export function useOperation(key: string | null) {
  useVersion();
  return key ? operations.get(key) : null;
}

export function useSending() {
  useVersion();
  return operations.sending();
}

export function useAccountKey(account: string) {
  const [digest, setDigest] = useState<{ account: string; value: string } | null>(null);
  useEffect(() => {
    let live = true;
    void accountDigest(account).then((value) => { if (live) setDigest({ account, value }); }, () => {});
    return () => { live = false; };
  }, [account]);
  return digest?.account === account ? digest.value : null;
}
