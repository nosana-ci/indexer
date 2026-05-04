export function buildDatabaseUrlFromParts(): string | undefined {
  const host = process.env.POSTGRES_HOST;
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB;
  const port = process.env.POSTGRES_PORT ?? "5432";
  const enableSsl = (process.env.POSTGRES_ENABLE_SSL ?? "true").toLowerCase() !== "false";
  const sslParams = "sslmode=verify-full&sslrootcert=/etc/ssl/certs/rds-global-bundle.pem";

  if (!host || !user || !password || !database) return undefined;

  const query = enableSsl ? `?${sslParams}` : "";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@${host}:${port}/${database}${query}`;
}
