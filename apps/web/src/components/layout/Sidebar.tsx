import { NavLink, useNavigate } from "react-router-dom";
import { Clock3, Plus, Send } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { SlackConnectionCard } from "./SlackConnectionCard";

export function Sidebar({
  scheduledCount,
  sentCount,
}: {
  scheduledCount: number;
  sentCount: number;
}) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? "bg-brand-50 text-brand-800"
        : "text-slate-600 hover:bg-slate-50"
    }`;

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-white px-4 py-5 md:h-full md:w-[220px] md:border-b-0 md:border-r md:px-3">
      <div className="mb-6 text-[1.35rem] font-black tracking-tight text-slate-900">
        ONE
      </div>

      {profile ? (
        <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-2">
          {profile.imageUrl ? (
            <img
              src={profile.imageUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700"
              aria-hidden
            >
              {profile.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{profile.name}</p>
            <p className="truncate text-[11px] text-muted">{profile.email}</p>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => navigate("/compose")}
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-brand-600 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        Compose
      </button>

      <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Email
      </p>
      <nav className="flex flex-col gap-0.5" aria-label="Email navigation">
        <NavLink to="/scheduled" className={linkClass}>
          <span className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 shrink-0" aria-hidden />
            Scheduled
          </span>
          <span className="text-xs tabular-nums text-muted">{scheduledCount}</span>
        </NavLink>
        <NavLink to="/sent" className={linkClass}>
          <span className="flex items-center gap-2">
            <Send className="h-4 w-4 shrink-0" aria-hidden />
            Sent
          </span>
          <span className="text-xs tabular-nums text-muted">{sentCount}</span>
        </NavLink>
      </nav>

      <div className="mt-auto space-y-3 border-t border-border pt-4 md:pt-5">
        <SlackConnectionCard />
        <button
          type="button"
          onClick={() => void signOut()}
          className="px-2 text-left text-[11px] text-muted hover:text-slate-800"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
