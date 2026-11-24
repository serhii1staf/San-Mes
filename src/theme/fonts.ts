import {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { Feather, Ionicons, MaterialIcons } from '@expo/vector-icons';

/**
 * Loaded before the first frame (`useFonts` in app/_layout.tsx gates the app on them).
 *
 * The icon fonts of the first screen are here too: the tab bar (Ionicons), the chat list
 * (MaterialIcons) and Feather, which most screens use. `@expo/vector-icons` loads a font the first
 * time one of its icons mounts and renders an empty text until then, so on every cold start the tab
 * bar showed up without its icons and they appeared a few frames later (recorded on iPhone, Nov 2026).
 * The fonts already ship with the app; this only registers them before anything draws. The larger
 * families seen only later (MaterialCommunityIcons, FontAwesome5) still load on first use.
 */
export const fontAssets = {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  // Optional chaining for test files that mock `@expo/vector-icons` with only the families they use.
  ...(Ionicons?.font ?? {}),
  ...(MaterialIcons?.font ?? {}),
  ...(Feather?.font ?? {}),
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
