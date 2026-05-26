import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';

export default function ProfileScreen() {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background.primary }]}>
      <View style={styles.content}>
        <Text variant="heading" weight="bold">
          Profile
        </Text>
        <Text variant="body" color={theme.colors.text.secondary}>
          Your profile will appear here
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
