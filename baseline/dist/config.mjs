// Paste the publishable key from Clerk Dashboard → API keys (it starts with
// pk_test_ or pk_live_). Publishable keys are meant for browser code, so it is
// safe to commit. Never put a secret key (sk_…) in this file.
export const CLERK_PUBLISHABLE_KEY = "pk_test_ZW5hYmxpbmctZHVjay03NDY0LmNsZXJrLmFjY291bnRzLmRldiQ";

// The public half of the VAPID key pair that signs weigh-in reminders (see
// server/push.mjs). Browsers subscribe to push messages with it, so it is safe
// to commit. The private half is the VAPID_PRIVATE_KEY environment variable.
export const PUSH_PUBLIC_KEY = "BO5jDhxGQIUiimb94CgWVpGV_s4u12caA5FQZ7XRSn5XshFJgKpMgcRv_w5KJDw7_RxWmWwFVWcI0vf_bLUHpfs";
