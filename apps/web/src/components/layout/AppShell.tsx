import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { api } from "../../api/client";

export function AppShell() {
  const [scheduledCount, setScheduledCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [scheduled, sent] = await Promise.all([
          api.listEmails("scheduled"),
          api.listEmails("sent"),
        ]);
        if (!cancelled) {
          setScheduledCount(scheduled.data.length);
          setSentCount(sent.data.length);
        }
      } catch {
        /* counts optional */
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-surface md:flex-row">
      <Sidebar scheduledCount={scheduledCount} sentCount={sentCount} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
