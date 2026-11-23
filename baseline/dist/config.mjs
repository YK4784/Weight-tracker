// Paste the publishable key from Clerk Dashboard → API keys (it starts with
// pk_test_ or pk_live_). Publishable keys are meant for browser code, so it is
// safe to commit. Never put a secret key (sk_…) in this file.
//
// The key names Clerk's Frontend API host (see frontendApiFor in account.mjs),
// such as enabling-duck-7464.clerk.accounts.dev now, or clerk.<your domain>
// for a production instance. auth.mjs and server/auth.mjs read it from here.
// When the key changes, change the host in these places too (npm test fails
// until they match):
// - index.html: the preconnect link.
// - vercel.json: script-src and connect-src in the Content Security Policy.
// And if the CLERK_PUBLISHABLE_KEY environment variable is set in Vercel, which
// overrides this key on the server, change or remove it. README.md, "Move to a
// Clerk production instance", has the whole checklist.
export const CLERK_PUBLISHABLE_KEY = "pk_test_ZW5hYmxpbmctZHVjay03NDY0LmNsZXJrLmFjY291bnRzLmRldiQ";

// The public half of the VAPID key pair that signs weigh-in reminders (see
// server/push.mjs). Browsers subscribe to push messages with it, so it is safe
// to commit. The private half is the VAPID_PRIVATE_KEY environment variable.
export const PUSH_PUBLIC_KEY = "BO5jDhxGQIUiimb94CgWVpGV_s4u12caA5FQZ7XRSn5XshFJgKpMgcRv_w5KJDw7_RxWmWwFVWcI0vf_bLUHpfs";
