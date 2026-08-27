import React from 'react';
import { Text as RNText, TextStyle } from 'react-native';
import { useTheme } from '../../theme';

type TextVariant = 'heading' | 'h2' | 'h3' | 'subheading' | 'body' | 'caption' | 'label';
type TextWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';

interface TextProps {
  children: React.ReactNode;
  variant?: TextVariant;
  weight?: TextWeight;
  color?: string;
  align?: TextStyle['textAlign'];
  style?: TextStyle;
  numberOfLines?: number;
  onPress?: () => void;
}

// ── WHY THIS FILE IS SHAPED LIKE THIS NOW ───────────────────────────────────
//
// This component is the most-mounted thing in the app. A feed card has five of it, a profile row four,
// a chat bubble two or three, and every list mounts a screenful at a time. It was also the cheapest
// thing to get wrong, and it was wrong in a way that scaled with exactly that:
//
// The previous version built, INSIDE the render body and on every single render,
//   - `variantStyles`: one outer object plus SEVEN nested style objects, of which six were then
//     discarded unused, each doing two or three float multiplications against the theme
//   - `weightToFont`: a five-key record, of which one entry was read
//   - `textStyle`: one more object
//   - `[textStyle, style]`: one array
//
// That is roughly eleven allocations and seventeen multiplications per instance per render, to produce
// one style object. A screenful of eight feed cards is on the order of four hundred throwaway objects
// per commit, all of them GC pressure on the thread that is trying to lay out a list. And because the
// component was not memoised, an unrelated parent re-render redid all of it.
//
// The lookups below are module-level frozen maps, so they are allocated once at import. Only the ONE
// requested variant is computed. `theme.fontFamily` is indexed directly by `weight` because its keys
// are already `light | regular | medium | semibold | bold` — the translation table never needed to
// exist. The result is memoised on its primitive inputs, and the component is wrapped in `memo`.
//
// `memo` is worth having here specifically because the React Compiler is enabled (see
// experiments.reactCompiler in app.json): call sites that pass an inline `style={{ ... }}` object get
// that object memoised at the call site by the compiler, so the props this component receives are now
// reference-stable across parent re-renders in a way they were not before. Without the compiler `memo`
// would mostly miss on those sites.

/** Which `theme.typography.sizes` key each variant reads. */
const VARIANT_SIZE_KEY = Object.freeze({
  heading: '2xl',
  h2: '2xl',
  h3: 'lg',
  subheading: 'lg',
  body: 'base',
  caption: 'sm',
  label: 'xs',
} as const);

/** Which `theme.typography.lineHeights` key each variant reads. */
const VARIANT_LINE_KEY = Object.freeze({
  heading: 'tight',
  h2: 'tight',
  h3: 'tight',
  subheading: 'tight',
  body: 'normal',
  caption: 'normal',
  label: 'normal',
} as const);

function TextBase({
  children,
  variant = 'body',
  weight = 'regular',
  color,
  align,
  style,
  numberOfLines,
  onPress,
}: TextProps) {
  const theme = useTheme();

  const fontSize = theme.typography.sizes[VARIANT_SIZE_KEY[variant]] * theme.fontScale;
  const lineHeight = fontSize * theme.typography.lineHeights[VARIANT_LINE_KEY[variant]];
  const fontFamily = theme.fontFamily[weight];
  const resolvedColor = color || theme.colors.text.primary;

  const textStyle = React.useMemo<TextStyle>(() => {
    const base: TextStyle = {
      color: resolvedColor,
      fontFamily,
      textAlign: align,
      fontSize,
      lineHeight,
    };
    // `label` is the only variant that carries anything beyond metrics. Kept as a branch rather than a
    // second merged object so the common variants allocate exactly one object.
    if (variant === 'label') {
      base.textTransform = 'uppercase';
      base.letterSpacing = 0.5;
    }
    return base;
  }, [resolvedColor, fontFamily, align, fontSize, lineHeight, variant]);

  // The `[textStyle, style]` array is memoised too. RN's shadow-tree diff compares the style prop by
  // identity first, so handing it a fresh array every render defeated that check even when nothing in
  // it had changed.
  const composed = React.useMemo(() => [textStyle, style], [textStyle, style]);

  return (
    <RNText style={composed} numberOfLines={numberOfLines} onPress={onPress}>
      {children}
    </RNText>
  );
}

export const Text = React.memo(TextBase);
Text.displayName = 'Text';
