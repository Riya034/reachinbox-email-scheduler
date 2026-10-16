export type EmailJobData = {
  emailId: string;
};

export function emailJobId(emailId: string): string {
  return `email-${emailId}`;
}
