import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  host: { type: "string", default: "127.0.0.1" },
  port: { type: "string", default: process.env.PORT || "4173" }
} });
const root = fileURLToPath(new URL("./dist/", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".mjs": "text/javascript", ".js": "text/javascript", ".svg": "image/svg+xml",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".txt": "text/plain"
};

// DATABASE_URL and friends come from .env.local, which `vercel env pull` writes.
try { process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url))); } catch { /* No local env file. */ }

// Runs the same function Vercel serves at /api/log. It's loaded on first use,
// so the static app still works before `npm install`.
let api;
async function forwardToApi(request, response) {
  try {
    api ??= (await import("../api/log.mjs")).default;
  } catch (error) {
    api = undefined;
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
  if (request.url === "/api/log" || request.url.startsWith("/api/log?")) {
    await forwardToApi(request, response);
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
  console.log("Baseline is running at http://" + values.host + ":" + server.address().port);
});
