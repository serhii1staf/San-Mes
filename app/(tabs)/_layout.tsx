import React from 'react';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { CustomTabBar } from '../../src/components/navigation/CustomTabBar';

// Stable references for `tabBar`/`screenOptions`/`tabBarIcon` so React Navigation
// doesn't see new prop identities on every render of the parent layout.

const renderTabBar = (props: React.ComponentProps<typeof CustomTabBar>) => (
  <CustomTabBar {...props} />
);

const screenOptions = {
  headerShown: false,
  sceneStyle: { backgroundColor: 'transparent' as const },
};

type TabBarIconProps = { color: string; size: number };

const HomeTabIcon = ({ color, size }: TabBarIconProps) => (
  <Feather name="home" size={size} color={color} />
);
const SearchTabIcon = ({ color, size }: TabBarIconProps) => (
  <Feather name="search" size={size} color={color} />
);
const CreateTabIcon = ({ color, size }: TabBarIconProps) => (
  <Feather name="plus-circle" size={size} color={color} />
);
const MessagesTabIcon = ({ color, size }: TabBarIconProps) => (
  <Feather name="message-circle" size={size} color={color} />
);
const ProfileTabIcon = ({ color, size }: TabBarIconProps) => (
  <Feather name="user" size={size} color={color} />
);

const homeOptions = { title: 'Home', tabBarIcon: HomeTabIcon };
const searchOptions = { title: 'Search', tabBarIcon: SearchTabIcon };
const createOptions = { title: 'Новый пост', headerShown: false, tabBarIcon: CreateTabIcon };
const messagesOptions = { title: 'Messages', tabBarIcon: MessagesTabIcon };
const profileOptions = { title: 'Profile', tabBarIcon: ProfileTabIcon };

export default function TabLayout() {
  return (
    <Tabs tabBar={renderTabBar} screenOptions={screenOptions}>
      <Tabs.Screen name="index" options={homeOptions} />
      <Tabs.Screen name="search" options={searchOptions} />
      <Tabs.Screen name="create" options={createOptions} />
      <Tabs.Screen name="messages" options={messagesOptions} />
      <Tabs.Screen name="profile" options={profileOptions} />
    </Tabs>
  );
}
