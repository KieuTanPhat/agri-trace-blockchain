"use client";

import { ThemeProvider as Provider, useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";

export function WorkspaceThemeProvider({ children }: { children: React.ReactNode }) {
  return <Provider attribute="class" defaultTheme="system" enableColorScheme={false} enableSystem storageKey="agritrace:color-mode" disableTransitionOnChange>
    {children}
    <Toaster closeButton position="bottom-right" />
  </Provider>;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" aria-label="Chế độ giao diện"><Sun className="size-4 dark:hidden" /><Moon className="hidden size-4 dark:block" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
        <DropdownMenuRadioItem value="light"><Sun className="mr-2 size-4" />Sáng</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark"><Moon className="mr-2 size-4" />Tối</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="system"><Monitor className="mr-2 size-4" />Hệ thống</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
