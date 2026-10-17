export type SlackApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; retryAfterSec?: number; revoked?: boolean };

type SlackPostMessageResponse = {
  ok: boolean;
  error?: string;
  retry_after?: number;
  ts?: string;
};

type SlackOpenConversationResponse = {
  ok: boolean;
  error?: string;
  retry_after?: number;
  channel?: { id: string };
};

export type SlackApiClient = {
  openDm: (slackUserId: string) => Promise<SlackApiResult<string>>;
  postMessage: (channelId: string, text: string) => Promise<SlackApiResult<void>>;
};

function parseSlackError(
  body: { error?: string; retry_after?: number },
): SlackApiResult<never> {
  const error = body.error ?? "slack_api_error";
  const revoked =
    error === "invalid_auth" ||
    error === "token_revoked" ||
    error === "account_inactive" ||
    error === "not_authed";
  return {
    ok: false,
    error,
    retryAfterSec: body.retry_after,
    revoked,
  };
}

export function createSlackApiClient(accessToken: string): SlackApiClient {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=utf-8",
  };

  return {
    async openDm(slackUserId: string) {
      const res = await fetch("https://slack.com/api/conversations.open", {
        method: "POST",
        headers,
        body: JSON.stringify({ users: slackUserId }),
      });
      const body = (await res.json()) as SlackOpenConversationResponse;
      if (!body.ok || !body.channel?.id) {
        return parseSlackError(body);
      }
      return { ok: true, data: body.channel.id };
    },

    async postMessage(channelId: string, text: string) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers,
        body: JSON.stringify({ channel: channelId, text }),
      });
      const body = (await res.json()) as SlackPostMessageResponse;
      if (!body.ok) {
        return parseSlackError(body);
      }
      return { ok: true, data: undefined };
    },
  };
}

/** Test hook: inject mock client */
let slackApiFactory: (token: string) => SlackApiClient = createSlackApiClient;

export function setSlackApiClientFactory(
  factory: (token: string) => SlackApiClient,
): void {
  slackApiFactory = factory;
}

export function resetSlackApiClientFactory(): void {
  slackApiFactory = createSlackApiClient;
}

export function getSlackApiClient(accessToken: string): SlackApiClient {
  return slackApiFactory(accessToken);
}
