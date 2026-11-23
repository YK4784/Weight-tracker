import { handleCspReport } from "../server/csp.mjs";

// Where browsers report what Baseline's Content Security Policy blocked, or
// would block while it's report-only (see vercel.json and server/csp.mjs).
export default { fetch: handleCspReport };
