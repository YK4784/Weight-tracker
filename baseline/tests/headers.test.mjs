import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { frontendApiFor } from "../dist/account.mjs";
import { CLERK_PUBLISHABLE_KEY } from "../dist/config.mjs";

const root = new URL("../../", import.meta.url);
const vercel = JSON.parse(await readFile(new URL("vercel.json", root), "utf8"));
const frontendApi = "https://" + frontendApiFor(CLERK_PUBLISHABLE_KEY);

// The headers vercel.json gives every route, by name in lower case.
const rules = vercel.headers ?? [];
const everyRoute = rules.find(rule => rule.source === "/(.*)");
const headers = Object.fromEntries((everyRoute?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]));
// The policy, report-only until it's switched on (see README.md).
const policyHeader = ["content-security-policy", "content-security-policy-report-only"].filter(name => headers[name]);
const policy = Object.fromEntries((headers[policyHeader[0]] ?? "").split(";").map(part => part.trim().split(/\s+/)).filter(([name]) => name)
  .map(([name, ...sources]) => [name, sources]));

test("every route gets the security headers", () => {
  assert.ok(everyRoute, "a rule for /(.*)");
  assert.equal(policyHeader.length, 1, "one Content Security Policy, enforced or report-only");
  assert.equal(headers["strict-transport-security"], "max-age=63072000; includeSubDomains");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["permissions-policy"], "camera=(), microphone=(), geolocation=(), payment=()");
  assert.equal(headers["x-frame-options"], "DENY");
  // npm start understands only paths and "(.*)", as baseline/serve.mjs does.
  for (const rule of rules) assert.match(rule.source, /^\/([\w.-]+\/?|\(\.\*\))*$/, rule.source);
});

test("the Content Security Policy lets in only the page's own code and Clerk's", () => {
  assert.deepEqual(policy["default-src"], ["'self'"]);
  assert.deepEqual(policy["script-src"], ["'self'", frontendApi, "https://challenges.cloudflare.com", "https://*.protect.clerk.com"],
    "change the host in vercel.json along with the key in config.mjs");
  assert.deepEqual(policy["connect-src"], ["'self'", frontendApi, "https://*.protect.clerk.com:*"]);
  assert.deepEqual(policy["img-src"], ["'self'", "https://img.clerk.com", "data:"]);
  assert.deepEqual(policy["style-src"], ["'self'", "'unsafe-inline'"], "Clerk adds its styles at run time");
  assert.deepEqual(policy["frame-src"], ["https://challenges.cloudflare.com", "https://*.protect.clerk.com"]);
  assert.deepEqual(policy["worker-src"], ["'self'", "blob:"]);
  assert.deepEqual(policy["font-src"], ["'self'"]);
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["form-action"], ["'self'"]);
  assert.deepEqual(policy["base-uri"], ["'none'"]);
  assert.deepEqual(policy["frame-ancestors"], ["'none'"]);
  assert.deepEqual(policy["report-uri"], ["/api/csp-report"]);
  for (const sources of Object.values(policy)) {
    assert.ok(!sources.includes("'unsafe-eval'") && !sources.includes("*") && !sources.includes("https:"), sources.join(" "));
  }
});

test("the policy's reports have somewhere to go", async () => {
  await access(new URL("api/csp-report.mjs", root));
});

// Starts `npm start`'s server on a free port and returns its address and a stop function.
async function serve(...args) {
  const child = spawn(process.execPath, [new URL("baseline/serve.mjs", root).pathname, "--port", "0", ...args], { stdio: ["ignore", "pipe", "inherit"] });
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", chunk => {
      output += chunk;
      const match = /running at (http:\/\/[\d.]+:\d+)/.exec(output);
      if (match) resolve(match[1]);
    });
    child.on("exit", code => reject(new Error("serve.mjs exited with " + code)));
  });
  return { origin, stop: () => child.kill() };
}

test("npm start sends vercel.json's headers on every response, and can enforce the policy", async () => {
  const local = await serve();
  try {
    for (const [path, status] of [["/", 200], ["/sw.js", 200], ["/health-data-privacy.html", 200], ["/missing", 404], ["/api/csp-report", 405]]) {
      const response = await fetch(local.origin + path);
      assert.equal(response.status, status, path);
      for (const name of Object.keys(headers)) assert.equal(response.headers.get(name), headers[name], path + ": " + name);
    }
  } finally {
    local.stop();
  }
  const enforced = await serve("--enforce-csp");
  try {
    const response = await fetch(enforced.origin + "/");
    assert.equal(response.headers.get("content-security-policy"), headers[policyHeader[0]]);
    assert.equal(response.headers.get("content-security-policy-report-only"), null);
  } finally {
    enforced.stop();
  }
});
