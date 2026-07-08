import type { ResolvedTheme } from "./theme";

export type TerminalThemeMode = "default" | "custom";

export interface CustomTerminalThemeColors {
  foreground: string;
  cursor: string;
}

export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
}

export interface XtermTerminalTheme extends TerminalThemeColors {
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TerminalThemeConfig {
  mode: TerminalThemeMode;
  custom: CustomTerminalThemeColors;
}

export const TERMINAL_THEME_STORAGE_KEY = "ternssh-terminal-theme";

const TRANSPARENT_BACKGROUND = "#00000000";

export const DEFAULT_CUSTOM_TERMINAL_COLORS: Record<
  ResolvedTheme,
  CustomTerminalThemeColors
> = {
  light: {
    foreground: "#171717",
    cursor: "#0f766e",
  },
  dark: {
    foreground: "#fafafa",
    cursor: "#72d4a8",
  },
};

const DARK_ANSI_PALETTE = {
  black: "#3d3d3d",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#abb2bf",
  brightBlack: "#5c6370",
  brightRed: "#be5046",
  brightGreen: "#98c379",
  brightYellow: "#d19a66",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
} as const;

const LIGHT_ANSI_PALETTE = {
  black: "#1e1e1e",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
} as const;

function parseHexColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value.toLowerCase();
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = parseHexColor(hex, "");
  if (!normalized) return null;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

/** True when the color reads as a light foreground on a dark terminal. */
export function isLightTerminalForeground(color: string): boolean {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55;
}

export function cssColorToHex(color: string, fallback: string): string {
  if (!color) return fallback;
  if (/^#[0-9a-fA-F]{6}$/i.test(color)) return color.toLowerCase();

  if (typeof document === "undefined") return fallback;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallback;

  try {
    ctx.fillStyle = color;
    const parsed = ctx.fillStyle;
    if (typeof parsed === "string" && /^#[0-9a-fA-F]{6}$/i.test(parsed)) {
      return parsed.toLowerCase();
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function buildXtermTheme(
  colors: TerminalThemeColors,
  appearance: ResolvedTheme,
): XtermTerminalTheme {
  const base =
    appearance === "dark" ? DARK_ANSI_PALETTE : LIGHT_ANSI_PALETTE;
  // Shells often echo bracketed paste with ANSI black/white/dim instead of the
  // default foreground; align neutral slots so paste matches typed text.
  const neutral = {
    black: colors.foreground,
    white: colors.foreground,
    brightBlack: colors.foreground,
    brightWhite: colors.foreground,
  };
  return {
    ...colors,
    ...base,
    ...neutral,
    cursorAccent: colors.background,
    selectionBackground:
      appearance === "dark"
        ? "rgba(255, 255, 255, 0.18)"
        : "rgba(0, 0, 0, 0.18)",
  };
}

export function resolveTerminalAppearance(
  config: TerminalThemeConfig,
  resolvedAppTheme: ResolvedTheme,
  colors: TerminalThemeColors,
): ResolvedTheme {
  if (config.mode === "custom") {
    return isLightTerminalForeground(colors.foreground) ? "dark" : "light";
  }
  return resolvedAppTheme;
}

export function getAppThemeTerminalColors(
  resolved: ResolvedTheme,
): CustomTerminalThemeColors {
  const fallback = DEFAULT_CUSTOM_TERMINAL_COLORS[resolved];
  if (typeof document === "undefined") return fallback;

  const styles = getComputedStyle(document.documentElement);
  const foreground = cssColorToHex(
    styles.getPropertyValue("--color-foreground").trim(),
    fallback.foreground,
  );
  const cursor = cssColorToHex(
    styles.getPropertyValue("--color-primary").trim(),
    fallback.cursor,
  );

  // Guard against CSS parse failures that yield a dark fg on dark theme (or vice versa).
  if (resolved === "dark" && !isLightTerminalForeground(foreground)) {
    return { foreground: fallback.foreground, cursor };
  }
  if (resolved === "light" && isLightTerminalForeground(foreground)) {
    return { foreground: fallback.foreground, cursor };
  }

  return { foreground, cursor };
}

export function resolveTerminalXtermTheme(
  config: TerminalThemeConfig,
  resolvedAppTheme: ResolvedTheme,
): TerminalThemeColors {
  const defaults = DEFAULT_CUSTOM_TERMINAL_COLORS[resolvedAppTheme];

  if (config.mode === "custom") {
    let foreground = config.custom.foreground;
    const cursor = config.custom.cursor;
    if (
      resolvedAppTheme === "dark" &&
      !isLightTerminalForeground(foreground)
    ) {
      foreground = defaults.foreground;
    }
    if (
      resolvedAppTheme === "light" &&
      isLightTerminalForeground(foreground)
    ) {
      foreground = defaults.foreground;
    }
    return {
      background: TRANSPARENT_BACKGROUND,
      foreground,
      cursor,
    };
  }

  return {
    background: TRANSPARENT_BACKGROUND,
    foreground: defaults.foreground,
    cursor: getAppThemeTerminalColors(resolvedAppTheme).cursor,
  };
}

export function createDefaultTerminalThemeConfig(): TerminalThemeConfig {
  return {
    mode: "default",
    custom: { ...DEFAULT_CUSTOM_TERMINAL_COLORS.dark },
  };
}

export function getStoredTerminalThemeConfig(): TerminalThemeConfig {
  const fallback = createDefaultTerminalThemeConfig();
  const stored = localStorage.getItem(TERMINAL_THEME_STORAGE_KEY);
  if (!stored) return fallback;

  try {
    const parsed = JSON.parse(stored) as Partial<{
      mode: TerminalThemeMode;
      custom: Partial<CustomTerminalThemeColors>;
    }>;
    const mode = parsed.mode === "custom" ? "custom" : "default";
    const base = DEFAULT_CUSTOM_TERMINAL_COLORS.dark;
    return {
      mode,
      custom: {
        foreground: parseHexColor(parsed.custom?.foreground, base.foreground),
        cursor: parseHexColor(parsed.custom?.cursor, base.cursor),
      },
    };
  } catch {
    return fallback;
  }
}

/** @deprecated Use resolveTerminalXtermTheme */
export function resolveTerminalTheme(
  config: TerminalThemeConfig,
  resolvedAppTheme: ResolvedTheme,
): TerminalThemeColors {
  return resolveTerminalXtermTheme(config, resolvedAppTheme);
}

export function getDefaultTerminalTheme(
  resolved: ResolvedTheme,
): TerminalThemeColors {
  return resolveTerminalXtermTheme(
    { mode: "default", custom: DEFAULT_CUSTOM_TERMINAL_COLORS.dark },
    resolved,
  );
}

export function getTerminalTheme(resolved: ResolvedTheme): TerminalThemeColors {
  return getDefaultTerminalTheme(resolved);
}
