import type { EmailStatus } from "../../types/api";

const styles: Record<EmailStatus, string> = {
  SCHEDULED: "bg-scheduled-bg text-orange-800 border-orange-200",
  QUEUED: "bg-scheduled-bg text-orange-800 border-orange-200",
  SENDING: "bg-blue-50 text-blue-800 border-blue-200",
  SENT: "bg-brand-50 text-brand-800 border-brand-200",
  FAILED: "bg-red-50 text-red-800 border-red-200",
  CANCELLED: "bg-slate-100 text-slate-600 border-slate-200",
};

const labels: Record<EmailStatus, string> = {
  SCHEDULED: "Scheduled",
  QUEUED: "Queued",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}
