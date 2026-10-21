"use client";

import { useEffect } from "react";
import { foldText } from "@/lib/text-fold";

export const FOCUS_FIELD_EVENT = "agritrace:focus-field";

/** Ask the shell to scroll to a label, column or heading once `pathname` shows it. */
export function requestFieldFocus(label: string, pathname: string) {
  window.dispatchEvent(new CustomEvent(FOCUS_FIELD_EVENT, { detail: { label, pathname } }));
}

const candidates =
  "label, legend, th, dt, h2, h3, summary, .manage-metric span, .manage-section-heading p, button, a";

function findField(label: string, pathname: string) {
  // The previous page may still be on screen right after navigation.
  if (window.location.pathname !== pathname) return null;
  const target = foldText(label);
  const main = document.getElementById("main-content");
  // Wait while the page is still loading its data or its form is locked.
  if (!main || main.querySelector(".manage-loading, .loading-state")) return null;
  let partial: HTMLElement | null = null;
  for (const element of main.querySelectorAll<HTMLElement>(candidates)) {
    if (element.closest(".shell-back, fieldset:disabled") || !element.offsetParent) continue;
    const text = foldText(element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text === target) return element;
    if (!partial && text.startsWith(target)) partial = element;
  }
  return partial;
}

/** Waits for the requested field to render (data may still be loading), then
 * scrolls it into view, focuses its control and highlights it briefly. */
export function FieldFocus() {
  useEffect(() => {
    let timer: number | undefined;
    const onRequest = (event: Event) => {
      const { label, pathname } = (event as CustomEvent<{ label: string; pathname: string }>).detail;
      window.clearInterval(timer);
      const started = Date.now();
      timer = window.setInterval(() => {
        const element = findField(label, pathname);
        if (!element && Date.now() - started < 6000) return;
        window.clearInterval(timer);
        if (!element) return;
        const details = element.closest("details");
        if (details && !details.open) details.open = true;
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        const control =
          element.tagName === "LABEL"
            ? element.querySelector<HTMLElement>("input, select, textarea")
            : null;
        control?.focus({ preventScroll: true });
        element.classList.remove("field-found");
        void element.offsetWidth;
        element.classList.add("field-found");
        window.setTimeout(() => element.classList.remove("field-found"), 2600);
      }, 150);
    };
    window.addEventListener(FOCUS_FIELD_EVENT, onRequest);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(FOCUS_FIELD_EVENT, onRequest);
    };
  }, []);
  return null;
}
