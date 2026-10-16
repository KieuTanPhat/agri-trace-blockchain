import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { palettes, radius, space, typography, type Palette, type ThemeId } from "./tokens";

/** "system" follows the OS light/dark setting; "outdoor" is the high-contrast field theme. */
export type ThemeMode = "system" | ThemeId;

type ThemeValue = {
  id: ThemeId;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  colors: Palette;
  space: typeof space;
  radius: typeof radius;
  type: typeof typography;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children, initialMode = "system" }: { children: ReactNode; initialMode?: ThemeMode }) {
  const scheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const id: ThemeId = mode === "system" ? (scheme === "dark" ? "dark" : "light") : mode;
  const value = useMemo(
    () => ({ id, mode, setMode, colors: palettes[id], space, radius, type: typography }),
    [id, mode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used inside ThemeProvider");
  return theme;
}
