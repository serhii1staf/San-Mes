import React from 'react';
import { View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';

const BADGES: Record<string, { label: string; color: string; icon: string }> = {
  developer: { label: 'Dev', color: '#6366F1', icon: 'code' },
  admin: { label: 'Admin', color: '#EF4444', icon: 'shield' },
  moderator: { label: 'Mod', color: '#F59E0B', icon: 'eye' },
  vip: { label: 'VIP', color: '#8B5CF6', icon: 'star' },
  creator: { label: 'Creator', color: '#EC4899', icon: 'film' },
  verified: { label: '✓', color: '#10B981', icon: 'check-circle' },
};

interface UserBadgeProps {
  badge: string;
  size?: 'sm' | 'md';
}

export function UserBadge({ badge, size = 'sm' }: UserBadgeProps) {
  const b = BADGES[badge];
  if (!b) return null;

  const fontSize = size === 'sm' ? 7 : 9;
  const iconSize = size === 'sm' ? 7 : 9;
  const px = size === 'sm' ? 4 : 6;
  const py = size === 'sm' ? 1 : 2;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: b.color + '15', paddingHorizontal: px, paddingVertical: py, borderRadius: 4 }}>
      <Feather name={b.icon as any} size={iconSize} color={b.color} />
      <Text style={{ fontSize, color: b.color, fontWeight: '700' }}>{b.label}</Text>
    </View>
  );
}
