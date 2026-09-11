import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

export type ThemeMode = "light" | "dark";

export interface ColorScheme {
  bg: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  primary: string;
  primaryText: string;
  link: string;
  ok: string;
  warn: string;
  danger: string;
}

export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 10, lg: 14 } as const;

export const MODALITY_LABELS: Record<string, string> = {
  resonador: "Resonador",
  tomografo: "Tomógrafo",
  ecografo: "Ecógrafo",
  "rayos-x": "Rayos X",
  mamografo: "Mamógrafo",
  otra: "Otro equipo",
};

// Paleta clara: menta/teal como acento sobre base clara, carbón sobre blanco.
const lightColor: ColorScheme = {
  bg: "#F5F8F7",
  surface: "#FFFFFF",
  surfaceMuted: "#EEF3F1",
  border: "#DCE6E2",
  text: "#131A18",
  textSecondary: "#5B6866",
  textTertiary: "#9AA6A3",
  primary: "#0FA98A",
  primaryText: "#FFFFFF",
  link: "#2563EB",
  ok: "#0FA98A",
  warn: "#B45309",
  danger: "#DC2626",
};

// Paleta oscura: mismo acento, ahora "glow" sobre negro.
const darkColor: ColorScheme = {
  bg: "#0A0F0E",
  surface: "#121817",
  surfaceMuted: "#182220",
  border: "#25302D",
  text: "#F2F6F5",
  textSecondary: "#8B9997",
  textTertiary: "#5B6866",
  primary: "#22D3AC",
  primaryText: "#06201A",
  link: "#60A5FA",
  ok: "#22D3AC",
  warn: "#FBBF24",
  danger: "#F87171",
};

export interface Typography {
  title: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
  heading: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
  body: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
  bodyMedium: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
  secondary: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
  caption: { fontFamily: string; fontSize: number; lineHeight: number; color: string };
}

function makeType(c: ColorScheme): Typography {
  return {
    title: { fontFamily: font.semibold, fontSize: 20, lineHeight: 26, color: c.text },
    heading: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20, color: c.text },
    body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: c.text },
    bodyMedium: { fontFamily: font.medium, fontSize: 15, lineHeight: 22, color: c.text },
    secondary: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: c.textSecondary },
    caption: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, color: c.textTertiary },
  };
}

export interface Theme {
  mode: ThemeMode;
  color: ColorScheme;
  type: Typography;
  statusColor: Record<string, string>;
  freshnessColor: Record<string, string>;
}

function buildTheme(mode: ThemeMode): Theme {
  const color = mode === "dark" ? darkColor : lightColor;
  return {
    mode,
    color,
    type: makeType(color),
    statusColor: { Confirmado: color.ok, Reportado: color.link, Estimado: color.warn, Desconocido: color.textTertiary },
    freshnessColor: { reciente: color.ok, "por verificar": color.warn, desactualizada: color.danger },
  };
}

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
  const theme = useMemo(() => buildTheme(mode), [mode]);
  const toggleMode = () => setOverride(mode === "light" ? "dark" : "light");
  const value = useMemo(() => ({ theme, mode, toggleMode }), [theme, mode]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
