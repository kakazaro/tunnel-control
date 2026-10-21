import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { bearerMatches, safeEqual, signSession, verifySession } from "../../src/worker/auth";

const SECRET = "a-very-long-session-secret-for-tests-0123456789";

describe("safeEqual / bearerMatches", () => {
  it("compares equal and different strings", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
    expect(await safeEqual("", "x")).toBe(false);
  });

  it("accepts only a matching Bearer header", async () => {
    expect(await bearerMatches("Bearer secret", "secret")).toBe(true);
    expect(await bearerMatches("Bearer wrong", "secret")).toBe(false);
    expect(await bearerMatches("secret", "secret")).toBe(false);
    expect(await bearerMatches(undefined, "secret")).toBe(false);
    expect(await bearerMatches("Bearer ", "")).toBe(false);
  });
});

describe("session tokens", () => {
  it("signs and verifies", async () => {
    expect(await verifySession(await signSession(SECRET), SECRET)).toBe(true);
  });

  it("rejects a wrong secret, a tampered token, garbage, and no token", async () => {
    const token = await signSession(SECRET);
    expect(await verifySession(token, "another-secret-another-secret-12345678")).toBe(false);
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(await verifySession(tampered, SECRET)).toBe(false);
    expect(await verifySession("not.a.jwt", SECRET)).toBe(false);
    expect(await verifySession(undefined, SECRET)).toBe(false);
  });

  it("rejects an expired token (12h)", async () => {
    const token = await signSession(SECRET, Date.now());
    expect(await verifySession(token, SECRET, Date.now() + 11 * 3600 * 1000)).toBe(true);
    expect(await verifySession(token, SECRET, Date.now() + 13 * 3600 * 1000)).toBe(false);
  });

  it("rejects tokens signed with another algorithm", async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS512" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifySession(forged, SECRET)).toBe(false);
  });
});
