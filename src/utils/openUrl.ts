import { Linking } from 'react-native';
import { router } from 'expo-router';
import { useSettingsStore } from '../store/settingsStore';

export function openUrl(url: string) {
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  const { useInAppBrowser } = useSettingsStore.getState();

  if (useInAppBrowser) {
    router.push({ pathname: '/browser', params: { url: encodeURIComponent(fullUrl) } });
  } else {
    Linking.openURL(fullUrl);
  }
}
