import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured:
    "Google sign-in is not configured on the server. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.",
  invalid_state: "Sign-in expired or was interrupted. Please try again.",
  invalid_callback: "Invalid Google callback. Please try again.",
  oauth_failed: "Google sign-in failed. Check server logs and OAuth credentials.",
  access_denied: "Google sign-in was cancelled.",
};

export function LoginPage() {
  const { signInWithGoogle, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const oauthError = useMemo(() => {
    const code = searchParams.get("error");
    if (!code) {
      return null;
    }
    return ERROR_MESSAGES[code] ?? `Sign-in error: ${code}`;
  }, [searchParams]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/scheduled", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f3f4f6] px-4 py-10">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-white px-8 py-10 shadow-sm">
        <h1 className="mb-10 text-center text-[2rem] font-bold leading-tight text-slate-900">
          Login
        </h1>

        {oauthError ? (
          <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
            {oauthError}
          </p>
        ) : null}

        <button
          type="button"
          onClick={signInWithGoogle}
          className="mb-5 flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-white py-3 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
        >
          <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Login with Google
        </button>

        <p className="mb-5 text-center text-xs text-muted">or sign up with email</p>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <label className="block text-sm font-medium text-slate-800">
            Email ID
            <input
              type="email"
              disabled
              placeholder="Use Google sign-in"
              className="mt-1.5 w-full cursor-not-allowed rounded-md border border-transparent bg-[#f0f2f5] px-3 py-3 text-sm text-slate-500"
              autoComplete="email"
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Password
            <input
              type="password"
              disabled
              className="mt-1.5 w-full cursor-not-allowed rounded-md border border-transparent bg-[#f0f2f5] px-3 py-3 text-sm text-slate-500"
              autoComplete="current-password"
            />
          </label>
          <Button
            type="button"
            shape="rect"
            className="mt-2 w-full py-3 opacity-60"
            variant="primary"
            disabled
          >
            Login
          </Button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted">
          Email/password login is not available. Sign in with your Google account.
        </p>
      </div>
    </div>
  );
}
