import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 text-lg font-semibold text-slate-800">{title}</div>
      {description ? (
        <p className="mb-6 max-w-sm text-sm text-muted">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
