import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import test from "node:test";
import { importJWK, jwtVerify } from "jose";
import { createPusher, encrypt, knownPushService, parseSubscription } from "../push.mjs";

// A device: its key pair and auth secret, and the subscription it would send.
function device(endpoint = "https://fcm.googleapis.com/fcm/send/abc123") {
  const keys = createECDH("prime256v1");
  keys.generateKeys();
  const auth = randomBytes(16);
  return { keys, auth, subscription: { endpoint, p256dh: keys.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
}

// What the device does with a message: RFC 8291 from the receiving side.
function decrypt({ keys, auth }, body) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverPublic = body.subarray(21, 21 + idLength);
  const hmac = (key, ...data) => createHmac("sha256", key).update(Buffer.concat(data)).digest();
  const shared = keys.computeSecret(serverPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.from("WebPush: info\0"), keys.getPublicKey(), serverPublic, Buffer.from([1]));
  const prk = hmac(salt, ikm);
  const decipher = createDecipheriv("aes-128-gcm", hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16),
    hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12));
  const record = body.subarray(21 + idLength);
  decipher.setAuthTag(record.subarray(-16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, "a single, last record");
  return plain.subarray(0, -1).toString();
}

function vapidKeys() {
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
  return { privateKey: jwk.d, publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url"), jwk };
}

test("only endpoints on the browsers' push services are accepted", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QOn", "https://wns2-par02p.notify.windows.com/w/?token=abc"
  ]) assert.equal(knownPushService(endpoint), true, endpoint);
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/abc", "https://fcm.googleapis.com.example.com/x", "https://evilpush.apple.com/x",
    "https://example.com/push.apple.com", "https://user:pass@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x",
    "https://169.254.169.254/latest", "not a url", ""
  ]) assert.equal(knownPushService(endpoint), false, endpoint);
});

test("a subscription needs a known endpoint, a P-256 public key and a 16-byte auth secret", () => {
  const { subscription } = device();
  const json = { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };
  assert.deepEqual(parseSubscription(json), subscription);
  const bad = [
    { endpoint: "https://example.com/x" }, { endpoint: "https://fcm.googleapis.com/" + "a".repeat(2048) },
    { keys: { ...json.keys, p256dh: json.keys.p256dh.slice(4) } }, { keys: { ...json.keys, auth: randomBytes(12).toString("base64url") } },
    { keys: { ...json.keys, p256dh: Buffer.from([3, ...randomBytes(64)]).toString("base64url") } },
    { keys: { ...json.keys, auth: "!!!!" } }, { keys: null }, { endpoint: 5 }
  ];
  for (const change of bad) assert.equal(parseSubscription({ ...json, ...change }), null, JSON.stringify(change).slice(0, 80));
  assert.equal(parseSubscription(null), null);
});

test("a message is encrypted so that only its device can read it", () => {
  const phone = device();
  const message = JSON.stringify({ title: "Weigh-in reminder", body: "You haven’t logged a weigh-in today." });
  const body = encrypt(phone.subscription, message);
  assert.equal(body.readUInt32BE(16), 4096, "record size");
  assert.equal(body[20], 65, "the server's public key follows the header");
  assert.equal(body.length, 21 + 65 + Buffer.byteLength(message) + 1 + 16);
  assert.equal(decrypt(phone, body), message);
  assert.throws(() => decrypt(device(), body), "another device can't read it");
  assert.notDeepEqual(encrypt(phone.subscription, message), body, "a new key and salt every time");
});

test("pushes are signed with the VAPID key and sent to the device's endpoint", async () => {
  const vapid = vapidKeys();
  const phone = device("https://web.push.apple.com/QOn-abc");
  const requests = [];
  const send = createPusher({ ...vapid, subject: "https://baseline.example", fetch: async (url, init) => {
    requests.push({ url, init });
    return new Response(null, { status: 201 });
  } });
  const now = Date.UTC(2026, 10, 22, 8, 0);
  assert.equal(await send(phone.subscription, { title: "Hi" }, { ttl: 1234.4, topic: "weigh-in", now }), 201);
  const [{ url, init }] = requests;
  assert.equal(url, phone.subscription.endpoint);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.TTL, "1234");
  assert.equal(init.headers.Topic, "weigh-in");
  assert.equal(init.headers["Content-Encoding"], "aes128gcm");
  const [, token, key] = init.headers.Authorization.match(/^vapid t=([^,]+), k=(\S+)$/);
  assert.equal(key, vapid.publicKey);
  const { payload } = await jwtVerify(token, await importJWK({ ...vapid.jwk, d: undefined }, "ES256"), { currentDate: new Date(now) });
  assert.deepEqual(payload, { aud: "https://web.push.apple.com", exp: now / 1000 + 12 * 3600, sub: "https://baseline.example" });
  assert.equal(decrypt(phone, init.body), JSON.stringify({ title: "Hi" }));
});

test("the pusher refuses a key that doesn't match, and endpoints it doesn't know", async () => {
  const vapid = vapidKeys();
  assert.throws(() => createPusher({ ...vapid, privateKey: vapidKeys().privateKey, subject: "https://x.example" }), /doesn't match/);
  assert.throws(() => createPusher({ ...vapid, privateKey: "", subject: "https://x.example" }), /VAPID_PRIVATE_KEY/);
  assert.throws(() => createPusher({ ...vapid, subject: "" }), /VAPID_SUBJECT/);
  let called = false;
  const send = createPusher({ ...vapid, subject: "https://x.example", fetch: async () => { called = true; return new Response(null, { status: 201 }); } });
  await assert.rejects(send({ ...device().subscription, endpoint: "https://example.com/x" }, {}), /push service/);
  assert.equal(called, false);
});
