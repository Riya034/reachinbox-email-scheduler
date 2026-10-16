import type {
  ApiError,
  Campaign,
  ScheduledEmail,
  SenderAccount,
} from "../types/api";

const BASE = "/api";

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: ApiError,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    throw new HttpError(
      body.error ?? `Request failed (${res.status})`,
      res.status,
      body as ApiError,
    );
  }
  return body;
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  listSenders: () =>
    request<{ data: SenderAccount[] }>("/sender-accounts"),

  createSender: (data: {
    label: string;
    hourlyLimit?: number;
    minDelayMs?: number;
  }) => request<SenderAccount>("/sender-accounts", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  listCampaigns: () =>
    request<{ data: Campaign[] }>("/campaigns"),

  createCampaign: (data: { name: string; senderAccountId: string }) =>
    request<Campaign>("/campaigns", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listEmails: (status: "scheduled" | "sent" | "all") =>
    request<{ data: ScheduledEmail[] }>(
      `/emails?status=${status}`,
    ),

  getEmail: (id: string) =>
    request<ScheduledEmail>(`/emails/${id}`),

  scheduleEmail: (data: {
    to: string;
    subject: string;
    body: string;
    scheduledAt: string;
    senderAccountId?: string;
    campaignId?: string;
    sequenceOrder?: number;
  }) =>
    request<ScheduledEmail>("/emails", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  cancelEmail: (id: string) =>
    request<ScheduledEmail>(`/emails/${id}`, { method: "DELETE" }),
};
