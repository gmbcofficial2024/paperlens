function encodedSecretForms(secret: string): string[] {
  const urlSearchEncoded = new URLSearchParams({ key: secret }).toString().replace(/^key=/, "");
  return [secret, encodeURIComponent(secret), urlSearchEncoded];
}

export function redactSecrets(
  body: string,
  secrets: Array<string | undefined>,
  maxLength?: number,
): string {
  let redacted = body;
  for (const secret of secrets) {
    if (!secret || secret.length <= 4) continue;
    for (const form of encodedSecretForms(secret)) {
      redacted = redacted.replaceAll(form, "[REDACTED]");
    }
  }
  return maxLength == null ? redacted : redacted.slice(0, maxLength);
}
