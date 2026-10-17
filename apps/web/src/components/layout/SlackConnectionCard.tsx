import { useCallback, useEffect, useState } from "react";
import { api, type SlackConnectionStatus } from "../../api/client";
import { Button } from "../ui/Button";

export function SlackConnectionCard() {
  const [status, setStatus] = useState<SlackConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const s = await api.slackStatus();
      setStatus(s);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not load Slack status");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("slack_connected") === "1") {
      void refresh();
      params.delete("slack_connected");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }
    const slackErr = params.get("slack_error");
    if (slackErr) {
      setActionError(
        slackErr === "access_denied"
          ? "Slack authorization was cancelled."
          : `Slack connection failed (${slackErr}).`,
      );
      params.delete("slack_error");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }
  }, [refresh]);

  const connect = () => {
    window.location.href = "/api/slack/connect";
  };

  const reconnect = () => {
    window.location.href = "/api/slack/reconnect";
  };

  const disconnect = async () => {
    setDisconnecting(true);
    setActionError(null);
    try {
      const s = await api.slackDisconnect();
      setStatus(s);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-slate-50 px-2.5 py-2">
      <p className="text-[11px] font-medium text-slate-700">Slack</p>
      {loading ? (
        <p className="mt-1 text-[11px] text-muted">Checking connection…</p>
      ) : status?.connected ? (
        <>
          <p className="mt-1 text-[11px] leading-snug text-slate-800">
            Connected to <span className="font-semibold">{status.teamName}</span>
          </p>
          <p className="text-[10px] text-muted">Rate-limit alerts via DM</p>
        </>
      ) : status?.revoked ? (
        <p className="mt-1 text-[11px] leading-snug text-amber-800">
          {status.error ?? "Access revoked — reconnect Slack."}
        </p>
      ) : (
        <p className="mt-1 text-[11px] leading-snug text-muted">
          Not connected — get notified when sends are postponed by rate limits.
        </p>
      )}
      {actionError ? (
        <p className="mt-1 text-[10px] leading-snug text-amber-800" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {status?.connected ? (
          <>
            <Button
              type="button"
              variant="outline"
              shape="rect"
              className="px-2 py-1 text-[10px]"
              onClick={reconnect}
            >
              Reconnect
            </Button>
            <Button
              type="button"
              variant="ghost"
              shape="rect"
              className="px-2 py-1 text-[10px]"
              disabled={disconnecting}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            shape="rect"
            className="px-2 py-1 text-[10px]"
            onClick={connect}
          >
            Connect Slack
          </Button>
        )}
      </div>
    </div>
  );
}
