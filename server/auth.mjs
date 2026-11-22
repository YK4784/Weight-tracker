import { createRemoteJWKSet, jwtVerify } from "jose";
import { CLERK_PUBLISHABLE_KEY } from "../baseline/dist/config.mjs";
import { frontendApiFor } from "../baseline/dist/account.mjs";

// Clerk signs session tokens with keys it publishes on the app's Frontend API,
// so verifying them needs no secret. CLERK_PUBLISHABLE_KEY in the environment
// overrides the key in config.mjs.
export function createVerifier(publishableKey = process.env.CLERK_PUBLISHABLE_KEY || CLERK_PUBLISHABLE_KEY) {
  const host = frontendApiFor(publishableKey);
  if (!host) throw new Error("The Clerk publishable key is missing or malformed.");
  const issuer = "https://" + host;
  const keys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks.json"));

  // Returns the signed-in user's ID, or null when the request has no valid session token.
  return async function verifyUser(request) {
    const header = request.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return null;
    try {
      const { payload } = await jwtVerify(header.slice(7), keys, { issuer, algorithms: ["RS256"], clockTolerance: 5 });
      // azp is the page that asked Clerk for the token. It must be this site.
      if (payload.azp !== undefined && payload.azp !== new URL(request.url).origin) return null;
      return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  };
}
