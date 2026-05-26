import React, { useState } from 'react';
import { View, FlatList, Image, Pressable, ViewStyle, TextInput, ScrollView, Dimensions } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { trendingTags, discoverCategories, mockPosts } from '../../src/utils/mockData';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 8;
const GRID_PADDING = 16;
const COLUMN_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

function SearchHeader() {
  const theme = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const [query, setQuery] = useState('');
  const inputWidth = useSharedValue(1);

  const animatedInputStyle = useAnimatedStyle(() => ({
    flex: inputWidth.value,
  }));

  const handleFocus = () => {
    setIsFocused(true);
    inputWidth.value = withTiming(1, { duration: 200 });
  };

  const handleBlur = () => {
    setIsFocused(false);
    inputWidth.value = withTiming(1, { duration: 200 });
  };

  const containerStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.background.elevated,
    borderRadius: theme.borderRadius.pill,
    marginHorizontal: theme.spacing.base,
    marginTop: theme.spacing.sm,
    borderWidth: isFocused ? 1.5 : 1,
    borderColor: isFocused ? theme.colors.accent.primary : theme.colors.border.light,
  };

  return (
    <Animated.View style={animatedInputStyle}>
      <View style={containerStyle}>
        <Feather
          name="search"
          size={18}
          color={isFocused ? theme.colors.accent.primary : theme.colors.text.tertiary}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people, posts, tags..."
          placeholderTextColor={theme.colors.text.tertiary}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={{
            flex: 1,
            marginLeft: theme.spacing.sm,
            fontSize: theme.typography.sizes.base,
            fontFamily: theme.fontFamily.regular,
            color: theme.colors.text.primary,
            paddingVertical: theme.spacing.xs,
          }}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')}>
            <Feather name="x" size={16} color={theme.colors.text.tertiary} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

function CategoryChips() {
  const theme = useTheme();
  const [selected, setSelected] = useState('All');

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.base,
        paddingVertical: theme.spacing.md,
      }}
    >
      {discoverCategories.map((cat, index) => {
        const isActive = selected === cat;
        return (
          <Animated.View key={cat} entering={FadeIn.delay(index * 50).duration(300)}>
            <Pressable
              onPress={() => setSelected(cat)}
              style={{
                paddingHorizontal: theme.spacing.base,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.borderRadius.pill,
                backgroundColor: isActive ? theme.colors.accent.primary : theme.colors.background.elevated,
                marginRight: theme.spacing.sm,
                borderWidth: isActive ? 0 : 1,
                borderColor: theme.colors.border.light,
              }}
            >
              <Text
                variant="caption"
                weight={isActive ? 'semibold' : 'regular'}
                color={isActive ? theme.colors.text.inverse : theme.colors.text.secondary}
              >
                {cat}
              </Text>
            </Pressable>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

function TrendingTags() {
  const theme = useTheme();

  return (
    <View style={{ paddingHorizontal: theme.spacing.base, marginBottom: theme.spacing.base }}>
      <Text variant="body" weight="semibold" style={{ marginBottom: theme.spacing.md }}>
        Trending
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {trendingTags.map((tag, index) => (
          <Animated.View key={tag} entering={FadeInDown.delay(index * 60).duration(300)}>
            <Pressable
              style={{
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.borderRadius.pill,
                backgroundColor: theme.colors.background.tertiary,
                borderWidth: 1,
                borderColor: theme.colors.border.light,
              }}
            >
              <Text variant="caption" color={theme.colors.accent.primary}>
                #{tag}
              </Text>
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

export default function SearchScreen() {
  const theme = useTheme();

  const discoverPosts = mockPosts.filter((p) => p.imageUrl);

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: theme.spacing['2xl'],
  };

  return (
    <View style={containerStyle}>
      <View style={{ paddingHorizontal: theme.spacing.base, paddingBottom: theme.spacing.sm }}>
        <Text variant="subheading" weight="bold">Discover</Text>
      </View>
      <SearchHeader />
      <FlatList
        data={discoverPosts}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={{
          paddingHorizontal: GRID_PADDING,
          paddingBottom: 100,
          gap: GRID_GAP,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <CategoryChips />
            <TrendingTags />
          </>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 100).duration(400)}>
            <Pressable
              style={{
                width: COLUMN_WIDTH,
                height: COLUMN_WIDTH * 1.2,
                borderRadius: theme.borderRadius.md,
                overflow: 'hidden',
              }}
            >
              <Image
                source={{ uri: item.imageUrl }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
              <View
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: theme.spacing.sm,
                  backgroundColor: 'rgba(0,0,0,0.3)',
                }}
              >
                <Text variant="caption" color="#fff" numberOfLines={1}>
                  {item.authorName}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        )}
      />
    </View>
  );
}
