import { Linking } from 'react-native';

/**
 * Открывает юридическую ссылку (Terms/Privacy) строго по схеме HTTPS.
 *
 * Проверка `https://` — защита на уровне приложения, дублирующая ATS:
 * даже подменённый или повреждённый URL не уйдёт по небезопасной схеме.
 *
 * @param url Адрес для открытия. Должен начинаться с `https://` (регистронезависимо).
 * @param onError Необязательный колбэк, вызываемый, если URL отклонён (не HTTPS)
 *   или открытие не удалось. Используется для показа сообщения об ошибке.
 * @returns `true`, если открытие было инициировано успешно; `false`, если URL
 *   отклонён из-за схемы или `Linking.openURL` бросил исключение.
 */
export async function openLegalLink(
  url: string,
  onError?: () => void,
): Promise<boolean> {
  if (!/^https:\/\//i.test(url)) {
    onError?.();
    return false;
  }
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    onError?.();
    return false;
  }
}
