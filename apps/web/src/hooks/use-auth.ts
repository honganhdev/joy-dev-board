import { useCallback, useEffect, useState } from 'react';
import {
  fetchCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  setUnauthorizedHandler,
} from '@/lib/api';

/**
 * Whether this browser has a session, and the two operations that change it.
 *
 * `checking` exists so the first paint is neither the board nor the login
 * screen: a page reload with a valid cookie should not flash a login form.
 */
export type AuthStatus = 'checking' | 'anonymous' | 'signed-in';

/**
 * One message for every kind of failure. The API already refuses to say whether
 * a username exists; repeating a more specific guess here would undo that.
 */
const SIGN_IN_FAILED = 'Incorrect username or password.';

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [username, setUsername] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchCurrentUser()
      .then((user) => {
        if (cancelled) return;
        setUsername(user.username);
        setStatus('signed-in');
      })
      .catch(() => {
        if (!cancelled) setStatus('anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A session revoked or expired mid-session shows up as a 401 on some later
  // request; that drops the app back here rather than to a broken board.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUsername(null);
      setStatus('anonymous');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (name: string, password: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const user = await loginRequest(name, password);
      setUsername(user.username);
      setStatus('signed-in');
    } catch {
      setError(SIGN_IN_FAILED);
    } finally {
      setSubmitting(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    // The cookie is cleared by the response either way; a failed request must
    // not strand someone on a board they can no longer load.
    await logoutRequest().catch(() => undefined);
    setUsername(null);
    setStatus('anonymous');
  }, []);

  return { status, username, submitting, error, signIn, signOut };
}
