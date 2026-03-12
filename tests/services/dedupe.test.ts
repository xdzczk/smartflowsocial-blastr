import { describe, it, expect, vi } from "vitest";

import { isPublished, markPublished } from "../../src/services/dedupe";

describe("dedupe", () => {
  it("isPublished returns false when key missing", async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(null),
    } as unknown as Parameters<typeof isPublished>[1];
    const out = await isPublished("event-id-123", kv);
    expect(out).toBe(false);
  });

  it("isPublished returns true when key exists", async () => {
    const kv = {
      get: vi.fn().mockResolvedValue("2024-01-01T00:00:00.000Z"),
    } as unknown as Parameters<typeof isPublished>[1];
    const out = await isPublished("event-id-123", kv);
    expect(out).toBe(true);
  });

  it("markPublished puts key with prefix", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const kv = { put } as unknown as Parameters<typeof markPublished>[1];
    await markPublished("evt-abc", kv);
    expect(put).toHaveBeenCalledWith(
      "published:evt-abc",
      expect.any(String),
      expect.objectContaining({ expirationTtl: 86400 * 7 }),
    );
  });
});
