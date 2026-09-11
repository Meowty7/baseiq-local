import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

export type ThemeMode = "light" | "dark";

export interface Theme {
  mode: ThemeMode;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  placeholder: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  statusColors: Record<string, string>;
  warningBg: string;
  warningText: string;
  dangerText: string;
}

// Tonos inspirados en qvac.tether.io: menta/teal como acento sobre base clara,
// carbón sobre blanco en modo día; el mismo acento se vuelve "glow" sobre negro en modo noche.
export const lightTheme: Theme = {
  mode: "light",
  bg: "#F5F8F7",
  surface: "#FFFFFF",
  surfaceAlt: "#EEF3F1",
  border: "#DCE6E2",
  text: "#131A18",
  textMuted: "#5B6866",
  placeholder: "#9AA6A3",
  accent: "#0FA98A",
  accentSoft: "rgba(15,169,138,0.12)",
  accentText: "#FFFFFF",
  statusColors: { Confirmado: "#0FA98A", Reportado: "#2563EB", Estimado: "#B45309", Desconocido: "#7A8785" },
  warningBg: "#FEF3C7",
  warningText: "#92400E",
  dangerText: "#DC2626",
};

export const darkTheme: Theme = {
  mode: "dark",
  bg: "#0A0F0E",
  surface: "#121817",
  surfaceAlt: "#182220",
  border: "#25302D",
  text: "#F2F6F5",
  textMuted: "#8B9997",
  placeholder: "#5B6866",
  accent: "#22D3AC",
  accentSoft: "rgba(34,211,172,0.14)",
  accentText: "#06201A",
  statusColors: { Confirmado: "#22D3AC", Reportado: "#60A5FA", Estimado: "#FBBF24", Desconocido: "#7E8A88" },
  warningBg: "rgba(251,191,36,0.10)",
  warningText: "#FBBF24",
  dangerText: "#F87171",
};

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [override, setOverride] = useState<ThemeMode | null>(null);
  const mode: ThemeMode = override ?? (system === "light" ? "light" : "dark");
  const theme = mode === "light" ? lightTheme : darkTheme;
  const toggleMode = () => setOverride(mode === "light" ? "dark" : "light");
  const value = useMemo(() => ({ theme, mode, toggleMode }), [theme, mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
