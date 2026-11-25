import pg from "pg";

export function createDatabase(databaseUrl) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    application_name: "captionmitra-worker"
  });

  pool.on("error", () => {
    // Do not log connection details or credentials.
  });

  return pool;
}
