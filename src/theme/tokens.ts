export const colors = {
  coral: {
    50: '#FFF0F0',
    100: '#FFE0E0',
    200: '#FFB8B8',
    300: '#FF8F8F',
    400: '#FF6B6B',
    500: '#E85D5D',
    600: '#D14E4E',
    700: '#B03F3F',
    800: '#8C3232',
    900: '#6B2626',
  },
  sage: {
    50: '#F0F5EF',
    100: '#E0EBE0',
    200: '#C2D7C0',
    300: '#A3C3A0',
    400: '#8FAE8B',
    500: '#7A9A76',
    600: '#658562',
    700: '#516D4F',
    800: '#3D553C',
    900: '#2A3D2A',
  },
  cream: {
    50: '#FFFDF9',
    100: '#FFF8F0',
    200: '#FFF3E6',
    300: '#FFEEDD',
    400: '#FFE8D4',
    500: '#FFE0C7',
    600: '#E6C9B0',
    700: '#CCB39A',
    800: '#B39C84',
    900: '#99866E',
  },
  charcoal: {
    50: '#F5F5F5',
    100: '#E8E8E8',
    200: '#D1D1D1',
    300: '#A3A3A3',
    400: '#757575',
    500: '#4A4A4A',
    600: '#3A3A3A',
    700: '#2D2D2D',
    800: '#1A1A1A',
    900: '#0D0D0D',
  },
  gold: {
    50: '#FFFDF0',
    100: '#FFF8D6',
    200: '#FFEFAD',
    300: '#FFE680',
    400: '#F4C553',
    500: '#E0B040',
    600: '#CC9A2D',
    700: '#A67D20',
    800: '#806015',
    900: '#5C440D',
  },
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 9999,
} as const;

export const typography = {
  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    '2xl': 30,
    '3xl': 36,
    '4xl': 48,
  },
  weights: {
    light: '300' as const,
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

export const lightTheme = {
  background: {
    primary: colors.cream[100],
    secondary: colors.cream[50],
    tertiary: colors.white,
    elevated: colors.white,
  },
  text: {
    primary: colors.charcoal[800],
    secondary: colors.charcoal[500],
    tertiary: colors.charcoal[400],
    inverse: colors.white,
  },
  accent: {
    primary: colors.coral[400],
    secondary: colors.sage[400],
    tertiary: colors.gold[400],
  },
  border: {
    light: colors.cream[300],
    medium: colors.charcoal[200],
    strong: colors.charcoal[300],
  },
  status: {
    success: colors.sage[500],
    warning: colors.gold[400],
    error: colors.coral[500],
  },
} as const;

export const darkTheme = {
  background: {
    primary: colors.charcoal[800],
    secondary: colors.charcoal[700],
    tertiary: colors.charcoal[600],
    elevated: colors.charcoal[600],
  },
  text: {
    primary: colors.cream[50],
    secondary: colors.charcoal[300],
    tertiary: colors.charcoal[400],
    inverse: colors.charcoal[800],
  },
  accent: {
    primary: colors.coral[300],
    secondary: colors.sage[300],
    tertiary: colors.gold[300],
  },
  border: {
    light: colors.charcoal[600],
    medium: colors.charcoal[500],
    strong: colors.charcoal[400],
  },
  status: {
    success: colors.sage[400],
    warning: colors.gold[300],
    error: colors.coral[400],
  },
} as const;

export interface ThemeColors {
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
    elevated: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string;
  };
  accent: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  border: {
    light: string;
    medium: string;
    strong: string;
  };
  status: {
    success: string;
    warning: string;
    error: string;
  };
}
