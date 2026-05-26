import React, { createContext, useContext, ReactNode } from 'react';
import { lightTheme, darkTheme, ThemeColors, colors, spacing, borderRadius, typography } from './tokens';
import { fontFamily } from './fonts';
import { shadows, getShadow } from './shadows';
import { timingConfigs, springConfigs } from './animations';
import { useThemeStore, ACCENT_COLORS } from '../store/themeStore';

export interface Theme {
  colors: ThemeColors;
  palette: typeof colors;
  spacing: typeof spacing;
  borderRadius: typeof borderRadius;
  typography: typeof typography;
  fontFamily: typeof fontFamily;
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
  const isDark = mode === 'dark';
  const baseColors = isDark ? darkTheme : lightTheme;

  // Find accent config
  const accentConfig = ACCENT_COLORS.find((c) => c.key === accent);
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
    fontFamily,
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
