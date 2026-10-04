import { useState } from "react";
import { signInWithPassword, signOut } from "../lib/auth";
import { useTasksContext } from "../context/TasksContext";
import { describeTaskError } from "../lib/tasks";

export function useAuth(onError: (m: string | null) => void) {
  // The session lives in TasksContext, not here.
  //
  // This hook used to keep its own copy, initialised once from
  // `getCurrentSession()` and never touched again. TasksContext kept a second
  // copy, also initialised at mount. On a fresh sign-in only this hook's copy
  // updated, so the context still believed nobody was signed in, and every
  // context-driven read bailed out: `refresh()` set the task list to `[]` and
  // returned, the polling effect returned, and `usePushNotifications` read the
  // session as null so reminders could not be enabled. Net effect was that
  // signing in and creating a task showed "Inbox is clear" until the page was
  // reloaded, at which point the provider re-read the stored session and
  // everything appeared to work.
  //
  // Demo mode hid this completely: `isApiMode` is false there, so `refresh()`
  // takes the local-fixtures branch instead. Only a live backend exposes it.
  const { authSession, setAuthSession } = useTasksContext();
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
