import { Card } from "./ui/Card";
import { InputField } from "./ui/InputField";
import { Button } from "./ui/Button";
import { SectionHeader } from "./ui/SectionHeader";

export function AuthCard({
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  isSigningIn,
  onSignIn,
}: {
  authEmail: string;
  setAuthEmail: (v: string) => void;
  authPassword: string;
  setAuthPassword: (v: string) => void;
  isSigningIn: boolean;
  onSignIn: () => void;
}) {
  return (
    <Card variant="floating" className="gap-4">
      <SectionHeader eyebrow="SIGN IN" title="Use your Supabase user" body="Sign in with the local auth user you created in Supabase Studio so the task flow uses the same bearer-token auth path the backend now enforces." />
      <InputField label="Email" placeholder="you@example.com" value={authEmail} onChangeText={setAuthEmail} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" />
      <InputField label="Password" placeholder="••••••••" value={authPassword} onChangeText={setAuthPassword} secureTextEntry textContentType="password" />
      <Button variant="primary" size="md" loading={isSigningIn} onPress={onSignIn}>{isSigningIn ? "Signing in..." : "Sign in"}</Button>
    </Card>
  );
}
