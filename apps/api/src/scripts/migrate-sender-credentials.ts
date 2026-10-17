/**
 * Idempotent migration: encrypt plaintext SenderAccount.smtpPass values.
 *
 * Before running in production:
 *   pg_dump -Fc reachinbox > reachinbox-backup.dump
 *
 * Rollback: restore backup or replace smtpPass from backup row values.
 *
 * Usage:
 *   npm run migrate:sender-credentials -w @reachinbox/api
 *   npm run migrate:sender-credentials -w @reachinbox/api -- --dry-run
 */
import { loadEnv } from "../config/env.js";
import { migratePlaintextSenderCredentials } from "../services/sender-credential.service.js";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const env = loadEnv();
  const result = await migratePlaintextSenderCredentials(env, { dryRun });

  console.log(
    JSON.stringify(
      {
        dryRun,
        migrated: result.migrated,
        skipped: result.skipped,
        failedCount: result.failed.length,
        failed: result.failed,
      },
      null,
      2,
    ),
  );

  if (result.failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
