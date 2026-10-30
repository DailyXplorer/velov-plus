"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "./icons";
import { toaster } from "@/lib/toast";

function subscribeDialogs(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  return () => observer.disconnect();
}

function topModal() {
  return [...document.querySelectorAll("dialog[open]")].findLast((dialog) => dialog.matches(":modal")) ?? null;
}

export function Toaster() {
  const toast = useSyncExternalStore(toaster.subscribe, toaster.current, () => null);
  const modal = useSyncExternalStore(subscribeDialogs, topModal, () => null);
  const region = (
    <div className="toast-region" role="status" aria-live="polite">
      {toast ? (
        <div className="toast" key={toast.id}>
          <p>{toast.message}</p>
          <button className="icon-button" aria-label="Fermer" onClick={() => toaster.dismiss(toast.id)}><XIcon size={18} weight="light"/></button>
        </div>
      ) : null}
    </div>
  );
  return modal ? createPortal(region, modal) : region;
}
