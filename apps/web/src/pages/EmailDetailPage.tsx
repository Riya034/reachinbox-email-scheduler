import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { api, HttpError } from "../api/client";
import type { ScheduledEmail } from "../types/api";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Button } from "../components/ui/Button";
import { formatDetailDate, getTimezoneLabel } from "../utils/dates";

export function EmailDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [email, setEmail] = useState<ScheduledEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getEmail(id);
        if (!cancelled) {
          setEmail(data);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof HttpError ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const canCancel =
    email &&
    (email.status === "SCHEDULED" ||
      email.status === "QUEUED" ||
      email.status === "SENDING");

  if (loading) {
    return <p className="p-8 text-sm text-muted">Loading…</p>;
  }
  if (error || !email) {
    return (
      <div className="p-8">
        <p className="text-sm text-red-600" role="alert">{error ?? "Not found"}</p>
        <Link to="/scheduled" className="mt-4 text-sm text-brand-700">
          Back to scheduled
        </Link>
      </div>
    );
  }

  const displayDate = email.sentAt
    ? formatDetailDate(email.sentAt)
    : formatDetailDate(email.scheduledAt);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="shrink-0 rounded-lg p-2 hover:bg-slate-50"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">
            {email.subject}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={email.status} />
          {canCancel ? (
            <Button
              variant="ghost"
              shape="rect"
              className="px-2 py-1.5"
              loading={cancelling}
              onClick={async () => {
                if (!window.confirm("Cancel this email?")) {
                  return;
                }
                setCancelling(true);
                try {
                  await api.cancelEmail(email.id);
                  navigate("/scheduled");
                } catch (e) {
                  setError(e instanceof HttpError ? e.message : "Cancel failed");
                } finally {
                  setCancelling(false);
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                {(email.senderAccount?.fromEmail?.charAt(0) ?? "A").toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">
                  {email.senderAccount?.label ?? "Sender"}
                </p>
                <p className="truncate text-sm text-muted">
                  &lt;{email.senderAccount?.fromEmail}&gt;
                </p>
                <p className="mt-1 text-sm text-muted">
                  to {email.to}
                </p>
              </div>
            </div>
            <p className="shrink-0 text-sm text-muted sm:text-right">
              {displayDate}
              <span className="mt-0.5 block text-[11px]">({getTimezoneLabel()})</span>
            </p>
          </div>

          <div
            className="whitespace-pre-wrap rounded-lg bg-[#f8f9fb] px-5 py-6 text-sm leading-relaxed text-slate-800"
          >
            {email.body}
          </div>

          {(email.smtpMessageId ||
            email.errorMessage ||
            email.lastPostponedAt ||
            email.attemptCount > 0) && (
            <details className="mt-6 rounded-lg border border-border bg-surface px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">
                Delivery details
              </summary>
              <dl className="mt-3 space-y-2 text-xs text-muted">
                {email.smtpMessageId ? (
                  <div>
                    <dt className="font-medium text-slate-600">SMTP message ID</dt>
                    <dd className="break-all font-mono">{email.smtpMessageId}</dd>
                  </div>
                ) : null}
                {email.errorMessage ? (
                  <div>
                    <dt className="font-medium text-red-600">Error</dt>
                    <dd className="text-red-600">{email.errorMessage}</dd>
                  </div>
                ) : null}
                {email.lastPostponedAt ? (
                  <div>
                    <dt className="font-medium text-slate-600">Last postponed</dt>
                    <dd>{formatDetailDate(email.lastPostponedAt)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-medium text-slate-600">Send attempts</dt>
                  <dd>{email.attemptCount}</dd>
                </div>
              </dl>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
