import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "tc_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const enc = new TextEncoder();

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", enc.encode(value));
}

/** Constant-time string comparison (hash both sides so the lengths always match). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

/** Checks an `Authorization: Bearer <token>` header against the expected token. */
export async function bearerMatches(header: string | undefined, token: string): Promise<boolean> {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  // Compare even when the header is missing so the timing does not reveal that.
  const equal = await safeEqual(match?.[1] ?? "", token);
  return equal && match !== null;
}

export async function signSession(secret: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin")
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SECONDS)
    .sign(enc.encode(secret));
}

export async function verifySession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, enc.encode(secret), {
      algorithms: ["HS256"],
      currentDate: new Date(now),
    });
    return true;
  } catch {
    return false;
  }
}
