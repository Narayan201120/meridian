import { useState } from "react";
import { getCurrentSession, signInWithPassword, signOut, type AuthSession } from "../lib/auth";
import { describeTaskError } from "../lib/tasks";

export function useAuth(onError: (m: string | null) => void) {
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getCurrentSession());
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignIn() {
    if (!authEmail.trim() || !authPassword) {
      onError("Enter the email and password for your Supabase user.");
      return;
    }
    setIsSigningIn(true);
    onError(null);
    try {
      const session = await signInWithPassword(authEmail, authPassword);
      setAuthSession(session);
      setAuthPassword("");
    } catch (e: any) {
      onError(describeTaskError(e));
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    onError(null);
    try {
      await signOut();
      setAuthSession(null);
    } catch (e: any) {
      onError(describeTaskError(e));
    } finally {
      setIsSigningOut(false);
    }
  }

  return { authSession, setAuthSession, authEmail, setAuthEmail, authPassword, setAuthPassword, isSigningIn, isSigningOut, handleSignIn, handleSignOut };
}
