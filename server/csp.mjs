// Reports of Content Security Policy violations, which browsers send to
// /api/csp-report (see the report-uri in vercel.json's policy). Each is logged
// as the directive it broke and the host it blocked, and nothing else: a
// report also carries the page's address, the blocked URL's path and query,
// and a sample of the script, any of which could hold something personal.

// The most of a report body that's read, and the most reports logged from one.
export const MAX_REPORT_BYTES = 64 * 1024;
const MAX_REPORTS = 10;

// What browsers put in blocked-uri in place of a URL.
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "data", "blob", "self", "trusted-types-policy", "trusted-types-sink"]);
const DIRECTIVE = /^[a-z][a-z-]{1,39}$/;
const HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/;

// The host a report says was blocked: a host name for a web address, a
// keyword such as "inline" or "eval", or a scheme such as "chrome-extension".
export function blockedHost(value) {
  if (typeof value !== "string" || !value) return "unknown";
  const keyword = value.toLowerCase();
  if (KEYWORDS.has(keyword)) return keyword;
  let url;
  try { url = new URL(value); } catch { return "unknown"; }
  if (["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return HOST.test(url.host) ? url.host : "unknown";
  const scheme = url.protocol.slice(0, -1);
  return KEYWORDS.has(scheme) || /^[a-z][a-z0-9+.-]{0,30}$/.test(scheme) ? scheme : "unknown";
}

// The directive a report says was broken, such as "script-src-elem".
export function brokenDirective(report) {
  const value = report?.effectiveDirective ?? report?.["effective-directive"] ?? report?.["violated-directive"];
  const directive = typeof value === "string" ? value.trim().split(/\s+/)[0].toLowerCase() : "";
  return DIRECTIVE.test(directive) ? directive : "unknown";
}

// The violations in a report body: report-uri's { "csp-report": {…} }, or the
// Reporting API's list of { type: "csp-violation", body: {…} }.
export function violations(text) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  const reports = Array.isArray(data)
    ? data.filter(item => item?.type === "csp-violation").map(item => item.body)
    : [data?.["csp-report"]];
  return reports.filter(report => report && typeof report === "object").slice(0, MAX_REPORTS)
    .map(report => ({ directive: brokenDirective(report), blocked: blockedHost(report.blockedURL ?? report["blocked-uri"]) }));
}

// The function behind /api/csp-report. It answers 204 to anything it accepts,
// so a browser has no reason to send a report again.
export async function handleCspReport(request) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
  const text = await request.text();
  if (text.length <= MAX_REPORT_BYTES) {
    for (const { directive, blocked } of violations(text)) console.log("CSP violation: " + directive + " blocked " + blocked);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
