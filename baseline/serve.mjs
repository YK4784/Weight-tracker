import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  host: { type: "string", default: "127.0.0.1" },
  port: { type: "string", default: process.env.PORT || "4173" },
  // Sends the Content Security Policy as Content-Security-Policy, so the
  // browser blocks what it would otherwise only report.
  "enforce-csp": { type: "boolean", default: false }
} });
const root = fileURLToPath(new URL("./dist/", import.meta.url));

// The response headers vercel.json gives each path, such as the Content
// Security Policy, so a local run behaves as the deployed site does. A source
// is a path, where "(.*)" stands for anything.
const headerRules = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8")).headers ?? [];
const sourcePattern = source => new RegExp("^" + source.split("(.*)").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
function securityHeaders(pathname) {
  const headers = {};
  for (const rule of headerRules) {
    if (!sourcePattern(rule.source).test(pathname)) continue;
    for (const { key, value } of rule.headers) {
      headers[values["enforce-csp"] && key === "Content-Security-Policy-Report-Only" ? "Content-Security-Policy" : key] = value;
    }
  }
  return headers;
}
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".mjs": "text/javascript", ".js": "text/javascript", ".svg": "image/svg+xml",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".txt": "text/plain"
};

// DATABASE_URL and friends come from .env.local, which `vercel env pull` writes.
try { process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url))); } catch { /* No local env file. */ }

// Runs the same functions Vercel serves at /api/log and /api/csp-report.
// They're loaded on first use, so the static app still works before `npm install`.
const functions = { "/api/log": "../api/log.mjs", "/api/csp-report": "../api/csp-report.mjs" };
const loaded = {};
async function forwardToApi(path, request, response) {
  let api;
  try {
    api = loaded[path] ??= (await import(functions[path])).default;
  } catch (error) {
    delete loaded[path];
    console.error(error);
    response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "The API couldn't start. Run npm install." }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const result = await api.fetch(new Request("http://" + request.headers.host + request.url, {
    method: request.method,
    headers: Object.entries(request.headers).flatMap(([name, value]) => [value].flat().map(item => [name, item])),
    body: ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.concat(chunks)
  }));
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  const path = request.url.split("?")[0];
  // Every response gets them, as on Vercel.
  for (const [key, value] of Object.entries(securityHeaders(path))) response.setHeader(key, value);
  if (Object.hasOwn(functions, path)) {
    await forwardToApi(path, request, response);
    return;
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400).end(); return; }
  const file = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(resolve(root) + sep)) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Content-Length": data.length, "Cache-Control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    response.writeHead(404).end("File not found");
  }
});
server.listen(Number(values.port), values.host, () => {
  console.log("Baseline is running at http://" + values.host + ":" + server.address().port +
    (values["enforce-csp"] ? ", with the Content Security Policy enforced" : ""));
});
