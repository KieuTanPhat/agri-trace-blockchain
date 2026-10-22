import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
/** Template select-trigger styling with native required/multiple/FormData semantics. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select data-slot="native-select" className={cn("border-input bg-background text-foreground w-full min-w-0 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50", className)} {...props} />;
}
