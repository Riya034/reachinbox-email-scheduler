import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { EmailJobData } from "./email.types.js";

export const EMAIL_QUEUE_NAME = "email-send";

export function createEmailQueue(connection: Redis): Queue<EmailJobData> {
  return new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
    },
  });
}
