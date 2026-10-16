import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bold,
  Clock,
  Italic,
  Link2,
  List,
  Paperclip,
  Pencil,
  Upload,
  X,
} from "lucide-react";
import { api, HttpError } from "../api/client";
import type { SenderAccount } from "../types/api";
import { Button } from "../components/ui/Button";
import { ComposeFieldRow } from "../components/compose/ComposeFieldRow";
import { SendLaterPopover } from "../components/compose/SendLaterPopover";
import {
  defaultScheduleLocal,
  getTimezoneLabel,
  toIsoFromLocalDateTime,
  tomorrowAt,
} from "../utils/dates";
import { isValidEmail, parseCsvOrTxtFile } from "../utils/recipients";

const VISIBLE_CHIPS = 3;

export function ComposePage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const sendLaterAnchorRef = useRef<HTMLDivElement>(null);

  const [senders, setSenders] = useState<SenderAccount[]>([]);
  const [senderId, setSenderId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [scheduledLocal, setScheduledLocal] = useState(defaultScheduleLocal());
  const [showSchedule, setShowSchedule] = useState(false);
  const [loadingSenders, setLoadingSenders] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);

  const loadSenders = useCallback(async () => {
    setLoadingSenders(true);
    try {
      const res = await api.listSenders();
      setSenders(res.data);
      if (res.data.length > 0 && !senderId) {
        const s = res.data[0];
        setSenderId(s.id);
        setDelaySeconds(Math.max(0, Math.round(s.minDelayMs / 1000)));
        setHourlyLimit(s.hourlyLimit);
      }
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Failed to load senders");
    } finally {
      setLoadingSenders(false);
    }
  }, [senderId]);

  useEffect(() => {
    void loadSenders();
  }, [loadSenders]);

  const onSenderChange = (id: string) => {
    setSenderId(id);
    const s = senders.find((x) => x.id === id);
    if (s) {
      setDelaySeconds(Math.max(0, Math.round(s.minDelayMs / 1000)));
      setHourlyLimit(s.hourlyLimit);
    }
  };

  const addRecipient = (raw: string) => {
    const email = raw.trim().toLowerCase();
    if (!email) {
      return;
    }
    if (!isValidEmail(email)) {
      setError(`Invalid email: ${email}`);
      return;
    }
    if (!recipients.includes(email)) {
      setRecipients((r) => [...r, email]);
    }
    setRecipientInput("");
    setError(null);
  };

  const handleFileImport = async (file: File) => {
    const text = await file.text();
    const { valid, invalid, duplicatesRemoved } = parseCsvOrTxtFile(text);
    setRecipients((prev) => {
      const set = new Set(prev);
      for (const v of valid) {
        set.add(v);
      }
      return [...set];
    });
    setImportInfo(
      `Imported ${valid.length} recipient(s). Skipped ${invalid.length} invalid, ${duplicatesRemoved} duplicate(s).`,
    );
    if (invalid.length > 0) {
      setError(`Some rows were invalid (e.g. ${invalid.slice(0, 2).join(", ")})`);
    }
  };

  const resolveSenderForLimits = async (): Promise<string> => {
    const current = senders.find((s) => s.id === senderId);
    const minDelayMs = delaySeconds * 1000;
    if (
      current &&
      current.minDelayMs === minDelayMs &&
      current.hourlyLimit === hourlyLimit
    ) {
      return current.id;
    }
    const label = `compose-${Date.now()}`;
    const created = await api.createSender({
      label,
      hourlyLimit,
      minDelayMs,
    });
    setSenders((s) => [created, ...s]);
    setSenderId(created.id);
    return created.id;
  };

  const schedule = async () => {
    setError(null);
    setSuccess(null);
    if (recipients.length === 0) {
      setError("Add at least one recipient.");
      return;
    }
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (!body.trim()) {
      setError("Message body is required.");
      return;
    }
    setSubmitting(true);
    try {
      const activeSenderId = await resolveSenderForLimits();
      const scheduledAt = toIsoFromLocalDateTime(scheduledLocal);
      let campaignId: string | undefined;

      if (recipients.length > 1) {
        const campaign = await api.createCampaign({
          name: `Compose ${new Date().toISOString()}`,
          senderAccountId: activeSenderId,
        });
        campaignId = campaign.id;
      }

      let ok = 0;
      for (let i = 0; i < recipients.length; i++) {
        await api.scheduleEmail({
          to: recipients[i],
          subject: subject.trim(),
          body: body.trim(),
          scheduledAt,
          senderAccountId: activeSenderId,
          campaignId,
          sequenceOrder: i,
        });
        ok += 1;
      }
      setSuccess(
        `Scheduled ${ok} email(s) for ${new Date(scheduledLocal).toLocaleString()} (${getTimezoneLabel()}).`,
      );
      setShowSchedule(false);
      setTimeout(() => navigate("/scheduled"), 1500);
    } catch (e) {
      setError(
        e instanceof HttpError
          ? `${e.message}${e.body?.detail ? `: ${e.body.detail}` : ""}`
          : "Scheduling failed",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const wrapSelection = (before: string, after: string) => {
    const el = bodyRef.current;
    if (!el) {
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = body.slice(start, end);
    const next =
      body.slice(0, start) + before + selected + after + body.slice(end);
    setBody(next);
  };

  const presets = [
    { label: "Tomorrow", date: tomorrowAt(9, 0) },
    { label: "Tomorrow, 10:00 AM", date: tomorrowAt(10, 0) },
    { label: "Tomorrow, 11:00 AM", date: tomorrowAt(11, 0) },
    { label: "Tomorrow, 2:00 PM", date: tomorrowAt(14, 0) },
  ];

  const applyPreset = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    setScheduledLocal(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  };

  const visibleRecipients = recipients.slice(0, VISIBLE_CHIPS);
  const hiddenCount = recipients.length - visibleRecipients.length;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="relative z-30 flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="shrink-0 rounded-lg p-2 hover:bg-slate-50"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="truncate text-base font-semibold sm:text-lg">
            Compose New Email
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            className="hidden rounded-lg p-2 text-brand-600 hover:bg-brand-50 sm:flex"
            title="Draft (not implemented)"
            disabled
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-muted hover:bg-slate-50"
            title="Attachments not supported by API"
            disabled
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-brand-600 hover:bg-brand-50"
            onClick={() => setShowSchedule(true)}
            aria-label="Open schedule"
          >
            <Clock className="h-5 w-5" />
          </button>
          <div ref={sendLaterAnchorRef} className="inline-flex">
            <Button
              variant="outline"
              shape="rect"
              className="hidden px-3 py-1.5 text-xs sm:inline-flex"
              onClick={() => setShowSchedule(true)}
            >
              Send Later
            </Button>
            <Button
              shape="rect"
              className="px-3 py-1.5 text-xs sm:hidden"
              variant="outline"
              onClick={() => setShowSchedule(true)}
            >
              Later
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-2 sm:px-8">
          {error ? (
            <p className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="mb-3 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-800" role="status">
              {success}
            </p>
          ) : null}

          <ComposeFieldRow label="From">
            {loadingSenders ? (
              <span className="text-sm text-muted">Loading senders…</span>
            ) : senders.length === 0 ? (
              <Button
                variant="outline"
                shape="rect"
                onClick={async () => {
                  const s = await api.createSender({
                    label: "default-ethereal",
                    hourlyLimit,
                    minDelayMs: delaySeconds * 1000,
                  });
                  setSenders([s]);
                  setSenderId(s.id);
                }}
              >
                Create Ethereal sender
              </Button>
            ) : (
              <select
                value={senderId}
                onChange={(e) => onSenderChange(e.target.value)}
                className="max-w-full truncate rounded-md border border-border bg-[#f0f2f5] px-3 py-2 text-sm text-slate-900"
                aria-label="Sender account"
                style={{ textOverflow: "ellipsis" }}
              >
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fromEmail}
                  </option>
                ))}
              </select>
            )}
          </ComposeFieldRow>

          <ComposeFieldRow
            label="To"
            trailing={
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Upload List</span>
              </button>
            }
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {visibleRecipients.map((r) => (
                <span
                  key={r}
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white"
                >
                  <span className="truncate">{r}</span>
                  <button
                    type="button"
                    className="shrink-0 opacity-90 hover:opacity-100"
                    aria-label={`Remove ${r}`}
                    onClick={() =>
                      setRecipients((list) => list.filter((x) => x !== r))
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {hiddenCount > 0 ? (
                <span className="rounded-md bg-brand-100 px-2 py-1 text-xs font-semibold text-brand-800">
                  +{hiddenCount}
                </span>
              ) : null}
              <input
                type="email"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addRecipient(recipientInput);
                  }
                }}
                onBlur={() => addRecipient(recipientInput)}
                placeholder="recipients@example.com"
                className="min-w-[8rem] flex-1 border-0 bg-transparent py-1 text-sm outline-none"
              />
            </div>
          </ComposeFieldRow>
          {importInfo ? (
            <p className="border-b border-border py-2 text-[11px] text-muted">{importInfo}</p>
          ) : null}
          {recipients.length > 0 ? (
            <p className="border-b border-border py-1 text-[11px] font-medium text-slate-600">
              {recipients.length} recipient(s)
            </p>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                void handleFileImport(f);
              }
              e.target.value = "";
            }}
          />

          <ComposeFieldRow label="Subject">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full border-0 bg-transparent text-sm outline-none"
            />
          </ComposeFieldRow>

          <div className="flex flex-wrap items-center gap-4 border-b border-border py-3 text-sm text-muted">
            <label className="flex items-center gap-2">
              Delay between 2 emails
              <input
                type="number"
                min={0}
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(Number(e.target.value) || 0)}
                className="w-12 rounded border border-border bg-white px-1 py-1 text-center text-sm tabular-nums text-slate-800"
              />
            </label>
            <label className="flex items-center gap-2">
              Hourly Limit
              <input
                type="number"
                min={1}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(Number(e.target.value) || 1)}
                className="w-14 rounded border border-border bg-white px-1 py-1 text-center text-sm tabular-nums text-slate-800"
              />
            </label>
            <span className="hidden text-[11px] text-muted lg:inline">
              New sender created if limits differ from selected account
            </span>
          </div>

          <div className="mt-2 flex min-h-[280px] flex-col rounded-lg bg-[#f0f2f5] sm:min-h-[360px]">
            <div className="flex flex-wrap gap-0.5 border-b border-slate-200/80 px-2 py-1.5">
              {[
                { icon: Bold, action: () => wrapSelection("**", "**") },
                { icon: Italic, action: () => wrapSelection("_", "_") },
                { icon: Link2, action: () => wrapSelection("[", "](url)") },
                { icon: List, action: () => setBody((b) => `${b}\n- `) },
              ].map(({ icon: Icon, action }, i) => (
                <button
                  key={i}
                  type="button"
                  className="rounded p-1.5 text-slate-500 hover:bg-white hover:text-slate-800"
                  onClick={action}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type Your Reply..."
              className="min-h-[220px] flex-1 resize-none border-0 bg-transparent px-4 py-3 text-sm outline-none sm:min-h-[300px]"
            />
          </div>

          <div className="mt-5 flex justify-end pb-6">
            <Button shape="rect" loading={submitting} onClick={() => void schedule()}>
              Schedule send
            </Button>
          </div>
        </div>
      </div>

      <SendLaterPopover
        open={showSchedule}
        anchorRef={sendLaterAnchorRef}
        scheduledLocal={scheduledLocal}
        onScheduledLocalChange={setScheduledLocal}
        presets={presets}
        onApplyPreset={applyPreset}
        onCancel={() => setShowSchedule(false)}
        onDone={() => void schedule()}
        submitting={submitting}
      />
    </div>
  );
}
