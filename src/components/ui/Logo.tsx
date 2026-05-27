import React from 'react';
import { Image, ImageStyle } from 'react-native';

interface LogoProps {
  size?: number;
  color?: string;
}

export function Logo({ size = 80 }: LogoProps) {
  const imageStyle: ImageStyle = {
    width: size,
    height: size,
    borderRadius: size * 0.2,
  };

  return (
    <Image
      source={require('../../../assets/icon.png')}
      style={imageStyle}
      resizeMode="contain"
    />
  );
}
