import { Redirect } from 'expo-router';

/** Sign-up lives on the welcome screen now (app/(auth)/welcome.tsx); this route opens it there. */
export default function RegisterRedirect() {
  return <Redirect href={{ pathname: '/(auth)/welcome', params: { mode: 'register' } }} />;
}
