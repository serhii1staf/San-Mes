import React, { createContext, useContext, ReactNode } from 'react';
import { lightTheme, darkTheme, ThemeColors, colors, spacing, borderRadius, typography } from './tokens';
import { fontFamily } from './fonts';
import { shadows, getShadow } from './shadows';
import { timingConfigs, springConfigs } from './animations';
import { useThemeStore, ACCENT_COLORS, FONT_SIZES } from '../store/themeStore';

export interface Theme {
  colors: ThemeColors;
  palette: typeof colors;
  spacing: typeof spacing;
  borderRadius: typeof borderRadius;
  typography: typeof typography;
  fontFamily: typeof fontFamily;
  fontScale: number;
  shadows: typeof shadows;
  getShadow: typeof getShadow;
  animations: {
    timing: typeof timingConfigs;
    spring: typeof springConfigs;
  };
  isDark: boolean;
}

const ThemeContext = createContext<Theme | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const mode = useThemeStore((state) => state.mode);
  const accent = useThemeStore((state) => state.accent);
  const fontSize = useThemeStore((state) => state.fontSize);
  const selectedFont = useThemeStore((state) => state.fontFamily);
  const isDark = mode === 'dark';
  const baseColors = isDark ? darkTheme : lightTheme;

  // Font scale
  const fontSizeConfig = FONT_SIZES.find(f => f.key === fontSize);
  const fontScale = fontSizeConfig?.scale || 1.0;

  // Font family mapping based on user selection
  const fontFamilyMap: Record<string, typeof fontFamily> = {
    inter: fontFamily, // loaded Inter fonts
    system: { light: 'System', regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
    serif: { light: 'Georgia', regular: 'Georgia', medium: 'Georgia', semibold: 'Georgia', bold: 'Georgia' },
    mono: { light: 'Courier', regular: 'Courier', medium: 'Courier New', semibold: 'Courier New', bold: 'Courier New' },
  };
  const activeFontFamily = fontFamilyMap[selectedFont] || fontFamily;

  // Find accent config (check AI themes too)
  const aiThemes = useThemeStore((s) => s.aiThemes);
  const accentConfig = ACCENT_COLORS.find((c) => c.key === accent) || aiThemes.find((c) => c.key === accent);
  const accentColor = accentConfig?.color || baseColors.accent.primary;

  // Build theme colors — override backgrounds with accent-tinted colors
  let themeColors: ThemeColors;

  if (isDark && accentConfig) {
    // Dark mode: apply accent-tinted backgrounds
    themeColors = {
      background: {
        primary: accentConfig.darkBg,
        secondary: accentConfig.darkSecondary,
        tertiary: accentConfig.darkElevated,
        elevated: accentConfig.darkElevated,
      },
      text: baseColors.text,
      accent: {
        primary: accentColor,
        secondary: accentConfig.color + '80', // 50% opacity version
        tertiary: baseColors.accent.tertiary,
      },
      border: {
        light: accentConfig.darkBorder,
        medium: accentConfig.darkBorder,
        strong: baseColors.border.strong,
      },
      status: baseColors.status,
    };
  } else if (!isDark && accentConfig) {
    // Light mode: apply accent-tinted light backgrounds
    themeColors = {
      background: {
        primary: accentConfig.light,
        secondary: '#FFFFFF',
        tertiary: '#FFFFFF',
        elevated: '#FFFFFF',
      },
      text: baseColors.text,
      accent: {
        primary: accentColor,
        secondary: accentConfig.color + '80',
        tertiary: baseColors.accent.tertiary,
      },
      border: {
        ...baseColors.border,
        light: accentConfig.color + '20',
      },
      status: baseColors.status,
    };
  } else {
    themeColors = {
      ...baseColors,
      accent: {
        ...baseColors.accent,
        primary: accentColor,
      },
    };
  }

  const theme: Theme = {
    colors: themeColors,
    palette: colors,
    spacing,
    borderRadius,
    typography,
    fontFamily: activeFontFamily,
    fontScale,
    shadows,
    getShadow,
    animations: {
      timing: timingConfigs,
      spring: springConfigs,
    },
    isDark,
  };

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
