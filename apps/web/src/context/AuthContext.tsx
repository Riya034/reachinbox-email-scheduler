import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  imageUrl: string | null;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  profile: UserProfile | null;
  signInWithGoogle: () => void;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const user = await api.me();
      setProfile(user);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      await refreshSession();
      setIsLoading(false);
    })();
  }, [refreshSession]);

  const signInWithGoogle = useCallback(() => {
    window.location.href = "/api/auth/google";
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setProfile(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated: profile !== null,
      isLoading,
      profile,
      signInWithGoogle,
      signOut,
      refreshSession,
    }),
    [profile, isLoading, signInWithGoogle, signOut, refreshSession],
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
