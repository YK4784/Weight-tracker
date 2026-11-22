import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { PUSH_PUBLIC_KEY } from "../baseline/dist/config.mjs";

// The push services of Chrome and other Chromium browsers, Edge, Firefox and
// Safari. The server posts to a device's endpoint, so it only accepts endpoints
// on these hosts, never an address someone made up.
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function knownPushService(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    PUSH_HOSTS.some(host => url.hostname === host || url.hostname.endsWith("." + host));
}

const bytes = value => typeof value === "string" && /^[A-Za-z0-9_-]+={0,2}$/.test(value) ? Buffer.from(value, "base64url") : Buffer.alloc(0);

// A browser's PushSubscription as JSON: the endpoint, the device's P-256 public
// key (65 bytes, uncompressed) and its 16-byte auth secret. Returns
// { endpoint, p256dh, auth } or null.
export function parseSubscription(value) {
  const endpoint = value?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length > 2048 || !knownPushService(endpoint)) return null;
  const p256dh = bytes(value.keys?.p256dh);
  const auth = bytes(value.keys?.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return { endpoint, p256dh: p256dh.toString("base64url"), auth: auth.toString("base64url") };
}

const hmac = (key, ...data) => createHmac("sha256", key).update(Buffer.concat(data)).digest();

// Encrypts a message for one device, as RFC 8291 sets out for web push: a
// one-off key pair agrees a secret with the device's key, and the result is a
// single aes128gcm record (RFC 8188) that only that device can read.
// `salt` and `serverKey` (a private key) are only given in tests.
export function encrypt(subscription, message, { salt = randomBytes(16), serverKey } = {}) {
  const devicePublic = Buffer.from(subscription.p256dh, "base64url");
  const authSecret = Buffer.from(subscription.auth, "base64url");
  const ecdh = createECDH("prime256v1");
  if (serverKey) ecdh.setPrivateKey(serverKey);
  else ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(devicePublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.from("WebPush: info\0"), devicePublic, serverPublic, Buffer.from([1]));
  const prk = hmac(salt, ikm);
  const key = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  // The message, then the delimiter that marks the last (and only) record.
  const record = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(message), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(4096, 16);
  header[20] = serverPublic.length;
  return Buffer.concat([header, serverPublic, record]);
}

// Sends web push messages signed with the VAPID key pair (RFC 8292). The public
// key is in config.mjs, where the app subscribes with it. The private key is
// the VAPID_PRIVATE_KEY environment variable. Push services may show the
// subject, a URL or mailto: address, to whoever runs them if something goes wrong.
export function createPusher({
  publicKey = PUSH_PUBLIC_KEY,
  privateKey = process.env.VAPID_PRIVATE_KEY,
  subject = process.env.VAPID_SUBJECT || (process.env.VERCEL_PROJECT_PRODUCTION_URL && "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL),
  fetch = globalThis.fetch
} = {}) {
  if (!privateKey) throw new Error("VAPID_PRIVATE_KEY is not set. Add it to the project's environment variables.");
  if (!subject) throw new Error("Set VAPID_SUBJECT to the site's https:// address or a mailto: address.");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
  const raw = Buffer.from(publicKey, "base64url");
  if (!ecdh.getPublicKey().equals(raw)) throw new Error("VAPID_PRIVATE_KEY doesn't match PUSH_PUBLIC_KEY in config.mjs.");
  const signingKey = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: privateKey, x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") },
    format: "jwk"
  });

  // Resolves to the push service's HTTP status: 201 when it accepted the
  // message, and 404 or 410 when the subscription no longer exists.
  return async function send(subscription, message, { ttl = 3600, topic, urgency = "normal", now = Date.now() } = {}) {
    if (!knownPushService(subscription.endpoint)) throw new Error("Not a known push service.");
    const token = await new SignJWT({ aud: new URL(subscription.endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })
      .setProtectedHeader({ typ: "JWT", alg: "ES256" })
      .sign(signingKey);
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: "vapid t=" + token + ", k=" + publicKey,
        TTL: String(Math.max(0, Math.round(ttl))),
        Urgency: urgency,
        ...(topic && { Topic: topic }),
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm"
      },
      body: encrypt(subscription, JSON.stringify(message)),
      signal: AbortSignal.timeout(10_000)
    });
    await response.body?.cancel();
    return response.status;
  };
}
