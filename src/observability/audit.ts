/**
 * Audit log for admin mutations. Emits structured JSON so logs can be filtered (e.g. audit: true).
 */
export type AuditAction =
  | "entitlement.upsert"
  | "user_policy.upsert"
  | "policy_relay.add"
  | "policy_relay.remove";

export interface AuditResource {
  pubkey?: string;
  relay_url?: string;
  [k: string]: unknown;
}

function getPrincipal(request: Request): string {
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return ip ? `ip:${ip}` : "api";
}

export function auditLog(
  request: Request,
  action: AuditAction,
  resource: AuditResource,
): void {
  const payload = {
    audit: true,
    timestamp: new Date().toISOString(),
    action,
    resource,
    principal: getPrincipal(request),
  };
  // Audit stream: structured JSON for compliance filtering
  console.info(JSON.stringify(payload));
}
