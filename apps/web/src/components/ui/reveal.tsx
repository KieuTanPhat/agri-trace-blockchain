"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type RevealState = "idle" | "hidden" | "shown";

/**
 * Fades content in once it scrolls into view. Content that is already visible on
 * first paint, or any browser without IntersectionObserver, is left untouched so
 * nothing is ever hidden without JavaScript.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "article" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<RevealState>("idle");

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    if (element.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setState("hidden");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setState("shown");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const style = { "--d": `${delay}ms` } as CSSProperties;
  return (
    <Tag
      ref={ref as never}
      className={className}
      style={style}
      data-reveal={state === "idle" ? undefined : state}
    >
      {children}
    </Tag>
  );
}
