import { useEffect, useRef } from "react";
import { Calendar } from "lucide-react";
import { Button } from "../ui/Button";
import { getTimezoneLabel } from "../../utils/dates";

type Preset = { label: string; date: Date };

export function SendLaterPopover({
  open,
  anchorRef,
  scheduledLocal,
  onScheduledLocalChange,
  presets,
  onApplyPreset,
  onCancel,
  onDone,
  submitting,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  scheduledLocal: string;
  onScheduledLocalChange: (v: string) => void;
  presets: Preset[];
  onApplyPreset: (d: Date) => void;
  onCancel: () => void;
  onDone: () => void;
  submitting?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (!open || !anchorRef.current || !panelRef.current) {
      return;
    }
    const anchor = anchorRef.current.getBoundingClientRect();
    const panel = panelRef.current;
    const margin = 8;
    let top = anchor.bottom + margin;
    let left = anchor.right - panel.offsetWidth;
    if (left < margin) {
      left = margin;
    }
    if (top + panel.offsetHeight > window.innerHeight - margin) {
      top = anchor.top - panel.offsetHeight - margin;
    }
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }, [open, anchorRef, scheduledLocal]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        aria-label="Close send later"
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-later-title"
        className="fixed z-50 w-[min(100vw-2rem,20rem)] rounded-xl border border-border bg-white p-5 shadow-lg"
      >
        <h2 id="send-later-title" className="mb-4 text-base font-semibold text-slate-900">
          Send Later
        </h2>
        <label className="mb-1 block text-xs font-medium text-muted">
          Pick date &amp; time
        </label>
        <div className="relative mb-2">
          <input
            type="datetime-local"
            value={scheduledLocal}
            onChange={(e) => onScheduledLocalChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-3 pr-10 text-sm"
          />
          <Calendar
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
        </div>
        <p className="mb-3 text-[11px] text-muted">
          Timezone: {getTimezoneLabel()}
        </p>
        <ul className="mb-4 space-y-0.5 border-t border-border pt-2 text-sm">
          {presets.map((p) => (
            <li key={p.label}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-2 text-left text-slate-700 hover:bg-brand-50"
                onClick={() => onApplyPreset(p.date)}
              >
                {p.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm font-medium text-muted hover:text-slate-800"
          >
            Cancel
          </button>
          <Button
            variant="outline"
            shape="rect"
            className="px-4 py-1.5"
            loading={submitting}
            onClick={onDone}
          >
            Done
          </Button>
        </div>
      </div>
    </>
  );
}
