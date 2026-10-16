import type { ReactNode } from "react";

export function ComposeFieldRow({
  label,
  children,
  trailing,
}: {
  label: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-4 border-b border-border py-3">
      <span className="w-14 shrink-0 text-sm text-muted sm:w-16">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
