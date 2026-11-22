import { Redirect } from 'expo-router';

/** Sign-in lives on the welcome screen now (app/(auth)/welcome.tsx); this route opens it there. */
export default function LoginRedirect() {
  return <Redirect href={{ pathname: '/(auth)/welcome', params: { mode: 'login' } }} />;
}
