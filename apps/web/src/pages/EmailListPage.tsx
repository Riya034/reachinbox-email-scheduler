import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { api, HttpError } from "../api/client";
import type { ScheduledEmail } from "../types/api";
import { EmailListItem } from "../components/email/EmailListItem";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { useNavigate } from "react-router-dom";

export function EmailListPage({ variant }: { variant: "scheduled" | "sent" }) {
  const navigate = useNavigate();
  const [emails, setEmails] = useState<ScheduledEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setError(null);
    } else {
      setRefreshing(true);
    }
    try {
      const res = await api.listEmails(variant);
      setEmails(res.data);
    } catch (e) {
      setError(
        e instanceof HttpError ? e.message : "Failed to load emails",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [variant]);

  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(() => void load(true), 12_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return emails;
    }
    return emails.filter(
      (e) =>
        e.to.toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q),
    );
  }, [emails, query]);

  const handleCancel = async (id: string) => {
    if (
      !window.confirm(
        "Cancel this scheduled email? It will be removed from the send queue.",
      )
    ) {
      return;
    }
    setCancelling(id);
    try {
      await api.cancelEmail(id);
      await load(true);
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Cancel failed");
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchNote(
                  e.target.value
                    ? "Client-side filter — Elasticsearch search API not implemented"
                    : null,
                );
              }}
              className="w-full rounded-full border border-border bg-surface py-2 pl-10 pr-4 text-sm"
              aria-label="Search emails"
            />
          </div>
          <button
            type="button"
            title="Filter (not implemented)"
            disabled
            className="hidden shrink-0 rounded-lg border border-border p-2 text-muted opacity-50 sm:flex"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Refresh list"
            className="shrink-0 rounded-lg border border-border p-2 text-muted hover:bg-slate-50 hover:text-slate-800"
            onClick={() => void load(true)}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        {searchNote ? (
          <p className="mt-2 text-[11px] text-muted">{searchNote}</p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {loading ? (
          <p className="p-8 text-sm text-muted">Loading emails…</p>
        ) : error ? (
          <div className="p-8">
            <p className="text-sm text-red-600" role="alert">{error}</p>
            <Button variant="outline" shape="rect" className="mt-4" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={query ? "No matches" : `No ${variant} emails`}
            description={
              query
                ? "Try a different search term."
                : "Compose a message and schedule it with Send Later."
            }
            action={
              !query ? (
                <Button shape="rect" onClick={() => navigate("/compose")}>
                  Compose
                </Button>
              ) : undefined
            }
          />
        ) : (
          filtered.map((email) => (
            <EmailListItem
              key={email.id}
              email={email}
              variant={variant}
              onCancel={variant === "scheduled" ? handleCancel : undefined}
              cancelling={cancelling}
            />
          ))
        )}
      </div>
    </div>
  );
}
