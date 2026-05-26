import { Easing, WithTimingConfig, WithSpringConfig } from 'react-native-reanimated';

export const timingConfigs = {
  fast: {
    duration: 150,
    easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  } as WithTimingConfig,
  normal: {
    duration: 250,
    easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  } as WithTimingConfig,
  slow: {
    duration: 400,
    easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  } as WithTimingConfig,
  gentle: {
    duration: 300,
    easing: Easing.bezier(0.4, 0, 0.2, 1),
  } as WithTimingConfig,
};

export const springConfigs = {
  snappy: {
    damping: 15,
    stiffness: 300,
    mass: 0.8,
  } as WithSpringConfig,
  bouncy: {
    damping: 10,
    stiffness: 200,
    mass: 1,
  } as WithSpringConfig,
  gentle: {
    damping: 20,
    stiffness: 150,
    mass: 1,
  } as WithSpringConfig,
  stiff: {
    damping: 25,
    stiffness: 400,
    mass: 0.6,
  } as WithSpringConfig,
};
