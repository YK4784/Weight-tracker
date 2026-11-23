import { CLERK_PUBLISHABLE_KEY } from "./config.mjs";
import { frontendApiFor } from "./account.mjs";

// The page's colors, through the --auth-* aliases in styles.css, so Clerk's
// components follow its light and dark palettes.
const appearance = {
  variables: {
    colorPrimary: "var(--auth-accent)",
    colorPrimaryForeground: "var(--auth-on-accent)",
    colorBackground: "var(--auth-surface)",
    colorForeground: "var(--auth-ink)",
    colorMutedForeground: "var(--auth-ink-2)",
    colorNeutral: "var(--auth-ink)",
    colorBorder: "var(--auth-ink)",
    colorInput: "var(--auth-surface)",
    colorInputForeground: "var(--auth-ink)",
    colorDanger: "var(--auth-danger)",
    colorRing: "var(--auth-accent)",
    colorModalBackdrop: "rgb(10 11 13 / 45%)",
    fontFamily: "var(--font)",
    borderRadius: "0.5rem"
  }
};

export class AuthSetupError extends Error {
  constructor() {
    super("CLERK_PUBLISHABLE_KEY in config.mjs is missing or malformed.");
    this.name = "AuthSetupError";
  }
}

function loadScript(src, attributes = {}) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.crossOrigin = "anonymous";
    script.async = false; // Run in insertion order: the UI bundle, then clerk-js.
    script.src = src;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("Couldn't load " + src)), { once: true });
    document.head.append(script);
  });
}

// Loads Clerk from the app's Frontend API, as Clerk's no-bundler setup does.
// A Clerk instance already on the page (from script tags in the HTML) is reused.
// Clerk keeps the account only. Weights, measurements, notes, the goal, sex and
// anything else from the log must never go into Clerk, including its user
// metadata (publicMetadata, privateMetadata and unsafeMetadata): Clerk's data
// processing agreement forbids health data, and the health data policy says
// none of the log goes to Clerk. See docs/processors.md.
export async function startClerk() {
  const host = frontendApiFor(CLERK_PUBLISHABLE_KEY);
  if (!host) throw new AuthSetupError();
  if (!window.Clerk) {
    await Promise.all([
      loadScript("https://" + host + "/npm/@clerk/ui@1/dist/ui.browser.js"),
      loadScript("https://" + host + "/npm/@clerk/clerk-js@6/dist/clerk.browser.js", { "data-clerk-publishable-key": CLERK_PUBLISHABLE_KEY })
    ]);
  }
  const clerk = window.Clerk;
  if (!clerk?.load) throw new Error("Clerk didn't initialize.");
  await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, appearance });
  return clerk;
}
