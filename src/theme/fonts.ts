import {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

export const fontAssets = {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
};

export interface FontFamily {
  light: string;
  regular: string;
  medium: string;
  semibold: string;
  bold: string;
}

// Typed with `string` fields (not `as const` literals) so alternate font
// families (System / Georgia / Courier) can be swapped in at runtime via the
// font-family picker without a type mismatch on the literal Inter names.
export const fontFamily: FontFamily = {
  light: 'Inter_300Light',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};
