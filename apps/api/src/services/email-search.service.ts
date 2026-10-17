import type { Client } from "@elastic/elasticsearch";
import { EmailStatus } from "@prisma/client";
import { EMAILS_INDEX } from "../lib/elasticsearch.js";
import { prisma } from "../lib/prisma.js";
import type { ScheduledEmail } from "@prisma/client";

export type EmailListVariant = "scheduled" | "sent";

const SCHEDULED_STATUSES: EmailStatus[] = [
  EmailStatus.SCHEDULED,
  EmailStatus.QUEUED,
  EmailStatus.SENDING,
];

const SENT_STATUSES: EmailStatus[] = [EmailStatus.SENT, EmailStatus.FAILED];

export type EmailSearchParams = {
  userId: string;
  q: string;
  variant: EmailListVariant;
  limit: number;
};

export function statusFilterForVariant(
  variant: EmailListVariant,
): EmailStatus[] {
  return variant === "scheduled" ? SCHEDULED_STATUSES : SENT_STATUSES;
}

/** Pure query builder for tests */
export function buildEmailSearchQuery(params: EmailSearchParams): {
  query: Record<string, unknown>;
  sort: unknown[];
} {
  const statuses = statusFilterForVariant(params.variant);
  const must: unknown[] = [
    { term: { userId: params.userId } },
    { terms: { status: statuses } },
  ];

  const q = params.q.trim();
  if (q.length > 0) {
    must.push({
      multi_match: {
        query: q,
        fields: ["subject^2", "to", "to.keyword", "fromEmail", "senderLabel"],
        type: "best_fields",
        fuzziness: "AUTO",
      },
    });
  }

  const sort =
    params.variant === "sent"
      ? [
          { sentAt: { order: "desc", missing: "_last" } },
          { scheduledAt: "desc" },
        ]
      : [{ scheduledAt: "desc" }, { sequenceOrder: "asc" }];

  return {
    query: { bool: { must } },
    sort,
  };
}

export type EmailSearchResult = {
  data: (ScheduledEmail & {
    senderAccount: { id: string; label: string; fromEmail: string };
    campaign: { id: string; name: string } | null;
  })[];
  meta: {
    engine: "elasticsearch";
    hitCount: number;
    omittedStale: number;
  };
};

export class ElasticsearchSearchUnavailableError extends Error {
  constructor(message = "Elasticsearch search is unavailable") {
    super(message);
    this.name = "ElasticsearchSearchUnavailableError";
  }
}

export async function searchEmails(
  client: Client,
  params: EmailSearchParams,
): Promise<EmailSearchResult> {
  const { query, sort } = buildEmailSearchQuery(params);

  let hits: { _id: string }[] = [];
  try {
    const response = await client.search({
      index: EMAILS_INDEX,
      size: params.limit,
      query,
      sort: sort as never,
    });
    hits = response.hits.hits.map((h: { _id?: string }) => ({ _id: String(h._id) }));
  } catch (err) {
    console.warn(
      "[es] search failed:",
      err instanceof Error ? err.message : String(err),
    );
    throw new ElasticsearchSearchUnavailableError();
  }

  if (hits.length === 0) {
    return {
      data: [],
      meta: { engine: "elasticsearch", hitCount: 0, omittedStale: 0 },
    };
  }

  const ids = hits.map((h) => h._id);
  const rows = await prisma.scheduledEmail.findMany({
    where: {
      id: { in: ids },
      userId: params.userId,
      status: { in: statusFilterForVariant(params.variant) },
    },
    include: {
      senderAccount: { select: { id: true, label: true, fromEmail: true } },
      campaign: { select: { id: true, name: true } },
    },
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: EmailSearchResult["data"] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) {
      ordered.push(row);
    }
  }

  return {
    data: ordered,
    meta: {
      engine: "elasticsearch",
      hitCount: hits.length,
      omittedStale: hits.length - ordered.length,
    },
  };
}
