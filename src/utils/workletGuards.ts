import { Platform } from 'react-native';

/**
 * True where a style mapper runs on Reanimated's UI runtime: native iOS and Android, outside jest.
 *
 * There, Reanimated also runs a style worklet on the JS thread to get the first style
 * (`initialUpdaterRun`, from `useAnimatedStyle` and again from each animated view's first render), and
 * in Reanimated 4.1 every `.value` read in those runs is a synchronous call into the UI runtime
 * (`executeOnUIRuntimeSync`): the JS thread waits until the UI thread answers.
 * A style worklet can test `UI_RUNTIME_MAPPERS && !globalThis._WORKLET` and return its resting style
 * on that first run. The mapper, which runs on the UI runtime where `_WORKLET` is true, then applies
 * the real values.
 *
 * On web and under jest the mapper itself runs on the JS thread with `_WORKLET` false, so the guard
 * must not apply there, or the style would never leave its resting value.
 */
export const UI_RUNTIME_MAPPERS = Platform.OS !== 'web' && !process.env.JEST_WORKER_ID;
