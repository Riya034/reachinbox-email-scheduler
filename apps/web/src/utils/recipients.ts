const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function parseRecipientList(text: string): string[] {
  const parts = text
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const p of parts) {
    if (!isValidEmail(p)) {
      continue;
    }
    if (!seen.has(p)) {
      seen.add(p);
      valid.push(p);
    }
  }
  return valid;
}

export function parseCsvOrTxtFile(content: string): {
  valid: string[];
  invalid: string[];
  duplicatesRemoved: number;
} {
  const lines = content.split(/\r?\n/);
  const raw: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const cols = trimmed.split(/[,;\t]/);
    for (const col of cols) {
      const email = col.trim().replace(/^["']|["']$/g, "");
      if (email) {
        raw.push(email);
      }
    }
  }

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (const item of raw) {
    const normalized = item.toLowerCase();
    if (!isValidEmail(normalized)) {
      invalid.push(item);
      continue;
    }
    if (seen.has(normalized)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(normalized);
    valid.push(normalized);
  }

  return { valid, invalid, duplicatesRemoved };
}
