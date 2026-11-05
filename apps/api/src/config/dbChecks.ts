/**
 * Returns human-readable warnings about common Neon misconfigurations.
 * Pure function (no I/O) so it can be unit tested. Never includes credentials in its output.
 */
export function databaseWarnings(databaseUrl: string, directUrl?: string): string[] {
  const warnings: string[] = [];
  let app: URL;
  try {
    app = new URL(databaseUrl);
  } catch {
    return warnings;
  }
  if (!app.hostname.endsWith('neon.tech')) return warnings;

  if (!app.hostname.includes('-pooler')) {
    warnings.push('DATABASE_URL points to Neon without the "-pooler" host. Use the pooled connection string for the running app.');
  }
  if (app.searchParams.get('sslmode') !== 'require') {
    warnings.push('DATABASE_URL should include sslmode=require (Neon only accepts encrypted connections).');
  }
  if (!directUrl) {
    warnings.push('DIRECT_URL is not set. Prisma migrations need the direct (non-pooled) Neon connection string.');
  } else {
    try {
      if (new URL(directUrl).hostname.includes('-pooler')) {
        warnings.push('DIRECT_URL must be the direct (non-pooled) connection string; migrations can fail through the pooler.');
      }
    } catch {
      // invalid URL is reported by env validation
    }
  }
  return warnings;
}
