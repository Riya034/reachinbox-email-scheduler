import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { api, HttpError } from "../api/client";
import type { ScheduledEmail } from "../types/api";
import { EmailListItem } from "../components/email/EmailListItem";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { useNavigate } from "react-router-dom";

const SEARCH_DEBOUNCE_MS = 350;

export function EmailListPage({ variant }: { variant: "scheduled" | "sent" }) {
  const navigate = useNavigate();
  const [emails, setEmails] = useState<ScheduledEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchMeta, setSearchMeta] = useState<{
    omittedStale?: number;
  } | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const loadList = useCallback(async (silent = false) => {
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

  const runSearch = useCallback(
    async (q: string) => {
      if (!q) {
        setSearchError(null);
        setSearchMeta(null);
        setSearching(false);
        await loadList(true);
        return;
      }
      setSearching(true);
      setSearchError(null);
      setSearchMeta(null);
      try {
        const res = await api.searchEmails(variant, q);
        setEmails(res.data);
        setSearchMeta(res.meta ?? null);
      } catch (e) {
        if (e instanceof HttpError && e.status === 503) {
          setSearchError(
            e.message ||
              "Search is temporarily unavailable. Showing may be outdated — clear search to reload from the server.",
          );
        } else {
          setSearchError(
            e instanceof HttpError ? e.message : "Search failed",
          );
        }
      } finally {
        setSearching(false);
        setLoading(false);
      }
    },
    [variant, loadList],
  );

  useEffect(() => {
    setLoading(true);
    void runSearch(debouncedQuery);
  }, [debouncedQuery, variant, runSearch]);

  useEffect(() => {
    if (debouncedQuery) {
      return;
    }
    const t = setInterval(() => void loadList(true), 12_000);
    return () => clearInterval(t);
  }, [loadList, debouncedQuery]);

  const showList = useMemo(() => emails, [emails]);

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
      if (debouncedQuery) {
        await runSearch(debouncedQuery);
      } else {
        await loadList(true);
      }
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Cancel failed");
    } finally {
      setCancelling(null);
    }
  };

  const isLoading = loading || searching;

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
              onChange={(e) => setQuery(e.target.value)}
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
            onClick={() =>
              void (debouncedQuery ? runSearch(debouncedQuery) : loadList(true))
            }
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing || searching ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        {debouncedQuery && !searchError ? (
          <p className="mt-2 text-[11px] text-muted">
            Search results from Elasticsearch
            {searchMeta?.omittedStale
              ? ` · ${searchMeta.omittedStale} outdated hit(s) hidden (PostgreSQL is authoritative)`
              : ""}
          </p>
        ) : null}
        {searchError ? (
          <p className="mt-2 text-[11px] text-amber-800" role="alert">
            {searchError}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {isLoading && showList.length === 0 ? (
          <p className="p-8 text-sm text-muted">Loading emails…</p>
        ) : error && !debouncedQuery ? (
          <div className="p-8">
            <p className="text-sm text-red-600" role="alert">{error}</p>
            <Button variant="outline" shape="rect" className="mt-4" onClick={() => void loadList()}>
              Retry
            </Button>
          </div>
        ) : showList.length === 0 ? (
          <EmptyState
            title={debouncedQuery ? "No matches" : `No ${variant} emails`}
            description={
              debouncedQuery
                ? "Try a different search term or clear search to see the full list."
                : "Compose a message and schedule it with Send Later."
            }
            action={
              !debouncedQuery ? (
                <Button shape="rect" onClick={() => navigate("/compose")}>
                  Compose
                </Button>
              ) : undefined
            }
          />
        ) : (
          showList.map((email) => (
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
