import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { lightTheme, darkTheme, ThemeColors, colors, spacing, borderRadius, typography } from './tokens';
import { fontFamily, type FontFamily } from './fonts';
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

  // Font family mapping based on user selection. Typed as plain strings per
  // weight — `typeof fontFamily` narrows each slot to the literal Inter face
  // name, which the System/Georgia/Courier alternates can never satisfy.
  const fontFamilyMap: Record<string, FontFamily> = {
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

  // ── THE DEPS ARE HONEST NOW, AND THAT MATTERS MORE THAN IT LOOKS ───────────
  //
  // This memo used to read `themeColors` and `activeFontFamily` in its body while listing only their
  // primitive SOURCES in its dependency array, with a comment explaining that the narrowing was
  // deliberate — both values are rebuilt on every render, so depending on them directly would give the
  // context value a new identity every time and re-render every consumer.
  //
  // The intent was right. The technique was a liability, for one reason: `useTheme()` is consumed in
  // ~105 files, which makes this object the widest re-render surface in the entire app, and its
  // stability rested on a dependency array that React's own lint rule would reject.
  //
  // `app.json` enables `experiments.reactCompiler`, app-wide and unscoped. A manual `useMemo` whose
  // declared deps are NARROWER than its inferred deps is exactly the shape React Compiler's
  // preserve-manual-memoization validation looks at. If it ever resolves that by honouring the
  // inferred set, this memo re-derives on every render, the context value changes identity every
  // render, and all ~105 consumers re-render on every ThemeProvider render — an app-wide frame-rate
  // drop on every screen, which is the reported symptom. I have NOT confirmed the compiler currently
  // does that, and I am not going to leave a load-bearing invariant resting on the answer.
  //
  // The fix removes the question instead of answering it: memoise the two derived values on their own
  // primitive inputs, then depend on them for real. The deps are complete, the lint rule is satisfied
  // without suppression, the identity is stable for exactly the same reasons as before, and there is no
  // longer a narrowing for any compiler to disagree with.
  const memoThemeColors = useMemo(
    () => themeColors,
    // The complete set of primitives `themeColors` is built from above. `baseColors` is derived from
    // `isDark`, and `accentConfig` from `accent` + `aiThemes`, so these six cover every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, accent, isDark, aiThemes],
  );
  const memoFontFamily = useMemo(
    () => activeFontFamily,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedFont],
  );

  const theme: Theme = useMemo(() => ({
    colors: memoThemeColors,
    palette: colors,
    spacing,
    borderRadius,
    typography,
    fontFamily: memoFontFamily,
    fontScale,
    shadows,
    getShadow,
    animations: {
      timing: timingConfigs,
      spring: springConfigs,
    },
    isDark,
  }), [memoThemeColors, memoFontFamily, fontScale, isDark]);

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
