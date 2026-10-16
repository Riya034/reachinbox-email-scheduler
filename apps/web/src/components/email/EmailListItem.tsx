import { Link } from "react-router-dom";
import { Clock, MoreHorizontal, Trash2 } from "lucide-react";
import type { ScheduledEmail } from "../../types/api";
import { StatusBadge } from "../ui/StatusBadge";
import { formatListDate } from "../../utils/dates";

export function EmailListItem({
  email,
  variant,
  onCancel,
  cancelling,
}: {
  email: ScheduledEmail;
  variant: "scheduled" | "sent";
  onCancel?: (id: string) => void;
  cancelling?: string | null;
}) {
  const preview = email.body.replace(/\s+/g, " ").slice(0, 100);
  const timeLabel =
    variant === "sent" && email.sentAt
      ? formatListDate(email.sentAt)
      : formatListDate(email.scheduledAt);

  const recipientName = email.to.split("@")[0];

  return (
    <article
      className="group flex items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-slate-50/80 sm:px-6"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-800">
            To: <span className="font-semibold capitalize">{recipientName}</span>
          </span>
          {variant === "scheduled" ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-scheduled-bg px-2 py-0.5 text-[11px] font-medium text-orange-900">
              <Clock className="h-3 w-3" aria-hidden />
              {timeLabel}
            </span>
          ) : (
            <StatusBadge status={email.status} />
          )}
        </div>
        <Link
          to={`/email/${email.id}`}
          className="mt-0.5 block truncate text-sm font-semibold text-slate-900 hover:text-brand-700"
        >
          {email.subject}
        </Link>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted">{preview}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-muted opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        {variant === "scheduled" &&
        (email.status === "SCHEDULED" || email.status === "QUEUED") &&
        onCancel ? (
          <>
            <button
              type="button"
              aria-label="Cancel scheduled email"
              className="rounded-md p-2 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              disabled={cancelling === email.id}
              onClick={() => onCancel(email.id)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <span
              className="rounded-md p-2 opacity-30"
              title="Reschedule not available in API"
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          </>
        ) : (
          <span className="hidden text-[11px] sm:inline">{timeLabel}</span>
        )}
      </div>
    </article>
  );
}
