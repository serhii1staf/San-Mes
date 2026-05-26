import React, { createContext, useContext, ReactNode } from 'react';
import { lightTheme, darkTheme, ThemeColors, colors, spacing, borderRadius, typography } from './tokens';
import { fontFamily } from './fonts';
import { shadows, getShadow } from './shadows';
import { timingConfigs, springConfigs } from './animations';
import { useThemeStore } from '../store/themeStore';

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
  const isDark = mode === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

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
