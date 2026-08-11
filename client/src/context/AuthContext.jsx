import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.get('/auth/me');
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    /**
     * Without the config the sign-in page has nothing to offer — no Google
     * button and no dev login — so a single failed request would strand the
     * user on a dead page. In development the API is routinely a moment behind
     * the dev server, so retry briefly instead of giving up.
     */
    const loadConfig = async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt += 1) {
        try {
          return await api.get('/auth/config');
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        }
      }
      return null;
    };

    (async () => {
      const [cfg] = await Promise.all([loadConfig(), refresh()]);
      if (cancelled) return;
      if (cfg) setConfig(cfg);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Sign-in is an upsert, so a retry after a dropped connection is harmless —
  // and worth it, because a whole hall signs in within the same minute and
  // that is the burstiest moment of the exam.
  const signInWithGoogle = useCallback(async (credential) => {
    const { user: me } = await api.post('/auth/google', { credential }, { retry: 5 });
    setUser(me);
    return me;
  }, []);

  const devSignIn = useCallback(async (email, role) => {
    const { user: me } = await api.post('/auth/dev-login', { email, role }, { retry: 5 });
    setUser(me);
    return me;
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, config, loading, refresh, signInWithGoogle, devSignIn, signOut }),
    [user, config, loading, refresh, signInWithGoogle, devSignIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
