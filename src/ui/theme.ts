// Sistema sobrio orientado a lectura: neutros, un solo acento, color solo para semántica de estado (texto/punto).
export const color = {
  bg: "#F6F7F8",
  surface: "#FFFFFF",
  surfaceMuted: "#F1F2F4",
  border: "#E4E6EA",
  text: "#111827",
  textSecondary: "#5B6472",
  textTertiary: "#9AA1AB",
  primary: "#111827",
  primaryText: "#FFFFFF",
  link: "#1D4ED8",
  ok: "#15803D",
  warn: "#B45309",
  danger: "#B91C1C",
} as const;

export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
} as const;

export const type = {
  title: { fontFamily: font.semibold, fontSize: 20, lineHeight: 26, color: color.text },
  heading: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20, color: color.text },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: color.text },
  bodyMedium: { fontFamily: font.medium, fontSize: 15, lineHeight: 22, color: color.text },
  secondary: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.textSecondary },
  caption: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, color: color.textTertiary },
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

export const STATUS_COLOR: Record<string, string> = {
  Confirmado: color.ok,
  Reportado: color.link,
  Estimado: color.warn,
  Desconocido: color.textTertiary,
};
