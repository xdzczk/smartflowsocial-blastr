/**
 * Vitest setup: ensure test env doesn't trigger config exit.
 * NODE_ENV is set by vitest; add any required env for validateEnvironment mocks here.
 */
process.env["ENVIRONMENT"] = process.env["ENVIRONMENT"] ?? "test";
