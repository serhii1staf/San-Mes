import React from 'react';
import { View, ViewStyle } from 'react-native';

interface LogoProps {
  size?: number;
  color?: string;
}

export function Logo({ size = 80, color = '#FF8F8F' }: LogoProps) {
  const scale = size / 80;

  const containerStyle: ViewStyle = {
    width: size,
    height: size,
    alignItems: 'center',
    justifyContent: 'center',
  };

  // Abstract bird/wing in flight - minimalist design
  // Main wing body (angled upward)
  const wingBodyStyle: ViewStyle = {
    position: 'absolute',
    width: 48 * scale,
    height: 18 * scale,
    borderRadius: 9 * scale,
    backgroundColor: color,
    transform: [{ rotate: '-15deg' }],
    top: 28 * scale,
    left: 18 * scale,
  };

  // Upper wing sweep (thinner, higher angle)
  const upperWingStyle: ViewStyle = {
    position: 'absolute',
    width: 36 * scale,
    height: 10 * scale,
    borderRadius: 5 * scale,
    backgroundColor: color,
    opacity: 0.7,
    transform: [{ rotate: '-35deg' }],
    top: 18 * scale,
    left: 24 * scale,
  };

  // Small accent element (tail/trailing feather)
  const tailStyle: ViewStyle = {
    position: 'absolute',
    width: 20 * scale,
    height: 6 * scale,
    borderRadius: 3 * scale,
    backgroundColor: color,
    opacity: 0.5,
    transform: [{ rotate: '-5deg' }],
    top: 42 * scale,
    left: 12 * scale,
  };

  // Small dot representing the head
  const headStyle: ViewStyle = {
    position: 'absolute',
    width: 8 * scale,
    height: 8 * scale,
    borderRadius: 4 * scale,
    backgroundColor: color,
    top: 22 * scale,
    right: 14 * scale,
  };

  return (
    <View style={containerStyle}>
      <View style={tailStyle} />
      <View style={wingBodyStyle} />
      <View style={upperWingStyle} />
      <View style={headStyle} />
    </View>
  );
}
