export type EmailStatus =
  | "SCHEDULED"
  | "QUEUED"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "CANCELLED";

export type SenderAccount = {
  id: string;
  label: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  hourlyLimit: number;
  minDelayMs: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Campaign = {
  id: string;
  userId: string;
  senderAccountId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  senderAccount?: { id: string; label: string; fromEmail: string };
};

export type ScheduledEmail = {
  id: string;
  userId: string;
  campaignId: string | null;
  senderAccountId: string;
  to: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sequenceOrder: number;
  status: EmailStatus;
  sentAt: string | null;
  smtpMessageId: string | null;
  errorMessage: string | null;
  attemptCount: number;
  bullJobId: string | null;
  lastPostponedAt: string | null;
  createdAt: string;
  updatedAt: string;
  senderAccount?: { id: string; label: string; fromEmail: string };
  campaign?: { id: string; name: string } | null;
};

export type ApiError = {
  error: string;
  detail?: string;
  details?: unknown;
};
