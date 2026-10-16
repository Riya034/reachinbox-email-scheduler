import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "reachinbox_dev_session";

export type DevProfile = {
  name: string;
  email: string;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  googleOAuthAvailable: false;
  profile: DevProfile | null;
  enterDevSession: (profile: DevProfile) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<DevProfile | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as DevProfile) : null;
    } catch {
      return null;
    }
  });

  const enterDevSession = useCallback((p: DevProfile) => {
    setProfile(p);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }, []);

  const signOut = useCallback(() => {
    setProfile(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated: profile !== null,
      googleOAuthAvailable: false as const,
      profile,
      enterDevSession,
      signOut,
    }),
    [profile, enterDevSession, signOut],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
