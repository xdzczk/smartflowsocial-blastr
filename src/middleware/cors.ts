import type { Env } from "../types";

export interface CorsConfig {
  enabled: boolean;
  allowedOrigins: Set<string>;
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAge: number;
}

function parseCorsConfig(env: Env): CorsConfig {
  const enabled = env.CORS_ENABLED === "true";
  const allowedOrigins = new Set<string>();
  if (enabled && env.CORS_ORIGINS) {
    for (const origin of env.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean)) {
      allowedOrigins.add(origin);
    }
  }
  return {
    enabled,
    allowedOrigins,
    allowedMethods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-TOKEN",
      "X-Correlation-ID",
      "X-Request-ID",
    ],
    maxAge: 86400,
  };
}

function isOriginAllowed(origin: string | null, config: CorsConfig): boolean {
  if (!config.enabled || config.allowedOrigins.size === 0) return false;
  if (!origin) return false;
  return config.allowedOrigins.has(origin);
}

export function getCorsConfig(env: Env): CorsConfig {
  return parseCorsConfig(env);
}

export function handleCorsPreflight(
  request: Request,
  config: CorsConfig,
): Response | null {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("Origin");
  if (!isOriginAllowed(origin, config))
    return new Response(null, { status: 403 });
  const corsHeaders = new Headers();
  corsHeaders.set("Access-Control-Allow-Origin", origin ?? "");
  corsHeaders.set(
    "Access-Control-Allow-Methods",
    config.allowedMethods.join(", "),
  );
  corsHeaders.set(
    "Access-Control-Allow-Headers",
    config.allowedHeaders.join(", "),
  );
  corsHeaders.set("Access-Control-Max-Age", String(config.maxAge));
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function addCorsHeaders(
  request: Request,
  response: Response,
  config: CorsConfig,
): Response {
  if (!config.enabled) return response;
  const origin = request.headers.get("Origin");
  if (!isOriginAllowed(origin, config)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin ?? "");
  headers.set("Access-Control-Allow-Credentials", "true");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
