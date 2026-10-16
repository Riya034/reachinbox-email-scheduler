import { useCallback, useEffect, useState } from "react";
import "./App.css";

type ScheduledEmail = {
  id: string;
  to: string;
  subject: string;
  body: string;
  scheduledAt: string;
  status: string;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type Tab = "scheduled" | "sent";

const defaultScheduleAt = (): string => {
  const d = new Date(Date.now() + 2 * 60 * 1000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
};

export default function App() {
  const [tab, setTab] = useState<Tab>("scheduled");
  const [emails, setEmails] = useState<ScheduledEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    to: "",
    subject: "",
    body: "",
    scheduledAtLocal: defaultScheduleAt(),
  });

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/emails?status=${tab}`);
      if (!res.ok) {
        throw new Error(`Failed to load emails (${res.status})`);
      }
      const json = (await res.json()) as { data: ScheduledEmail[] };
      setEmails(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void loadEmails();
    const interval = setInterval(() => void loadEmails(), 10_000);
    return () => clearInterval(interval);
  }, [loadEmails]);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const scheduledAt = new Date(form.scheduledAtLocal).toISOString();
    try {
      const res = await fetch("/api/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: form.to,
          subject: form.subject,
          body: form.body,
          scheduledAt,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Schedule failed (${res.status})`);
      }
      setForm((f) => ({ ...f, subject: "", body: "", to: "" }));
      setTab("scheduled");
      await loadEmails();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schedule failed");
    }
  };

  const handleCancel = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/emails/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`Cancel failed (${res.status})`);
      }
      await loadEmails();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  return (
    <div className="app">
      <header>
        <h1>ReachInbox Email Scheduler</h1>
        <p>Schedule outbound emails with BullMQ — jobs persist across restarts</p>
      </header>

      <section className="card">
        <h2>Schedule email</h2>
        <form className="form" onSubmit={handleSchedule}>
          <label>
            To
            <input
              type="email"
              required
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
              placeholder="recipient@example.com"
            />
          </label>
          <label>
            Subject
            <input
              required
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </label>
          <label>
            Body
            <textarea
              required
              rows={4}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
          <label>
            Send at (local time)
            <input
              type="datetime-local"
              required
              value={form.scheduledAtLocal}
              onChange={(e) => setForm({ ...form, scheduledAtLocal: e.target.value })}
            />
          </label>
          <button type="submit">Schedule</button>
        </form>
      </section>

      <section className="card">
        <div className="tabs">
          <button
            type="button"
            className={tab === "scheduled" ? "active" : ""}
            onClick={() => setTab("scheduled")}
          >
            Scheduled
          </button>
          <button
            type="button"
            className={tab === "sent" ? "active" : ""}
            onClick={() => setTab("sent")}
          >
            Sent / failed
          </button>
          <button type="button" className="ghost" onClick={() => void loadEmails()}>
            Refresh
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {loading && emails.length === 0 ? <p>Loading…</p> : null}
        <ul className="email-list">
          {emails.map((email) => (
            <li key={email.id}>
              <div className="email-row">
                <div>
                  <strong>{email.subject}</strong>
                  <span className="meta">
                    → {email.to} · {email.status} ·{" "}
                    {new Date(email.scheduledAt).toLocaleString()}
                  </span>
                  {email.sentAt && (
                    <span className="meta">Sent {new Date(email.sentAt).toLocaleString()}</span>
                  )}
                  {email.errorMessage && (
                    <span className="error-text">{email.errorMessage}</span>
                  )}
                </div>
                {["SCHEDULED", "QUEUED"].includes(email.status) && (
                  <button type="button" className="ghost" onClick={() => void handleCancel(email.id)}>
                    Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!loading && emails.length === 0 && <p className="muted">No emails in this view.</p>}
      </section>
    </div>
  );
}
