import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const dist = new URL("../dist/", import.meta.url);
const source = await readFile(new URL("sw.js", dist), "utf8");
const shell = JSON.parse(/^const SHELL = (\[[^\]]*\]);$/m.exec(source)[1]);

// Files in baseline/dist/ that the worker leaves out on purpose.
const LEFT_OUT = {
  "sw.js": "the worker itself, which the browser fetches and updates on its own",
  "fonts/OFL.txt": "the font's license, which the app never loads"
};

test("the worker keeps every file in baseline/dist/, except the ones left out on purpose", async () => {
  const root = fileURLToPath(dist);
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
  assert.ok(files.includes("app.mjs") && files.includes("fonts/funnel-sans-latin.woff2"));
  const missing = files.filter(file => !shell.includes(file) && !(file in LEFT_OUT));
  assert.deepEqual(missing, [], "add each to SHELL in sw.js, or to LEFT_OUT here with the reason");
  // Every listed file exists, once, and the page is listed by both its names.
  assert.deepEqual(shell.filter(file => file !== "./" && !files.includes(file)), []);
  assert.equal(new Set(shell).size, shell.length);
  assert.ok(shell.includes("./") && shell.includes("index.html"));
  assert.deepEqual(Object.keys(LEFT_OUT).filter(file => shell.includes(file) || !files.includes(file)), []);
});

test("the cache is named with a version", () => {
  assert.match(source, /^const CACHE = "baseline-shell-v\d+";$/m);
});

// Runs sw.js with a fake network and cache. Time runs a thousand times faster,
// so the network timeout passes in a few ms.
const ORIGIN = "https://baseline.test";
const at = path => new URL(path, ORIGIN + "/").href;

function startWorker({ network = () => Promise.reject(new TypeError("Failed to fetch")) } = {}) {
  const listeners = {};
  const stores = new Map();
  const claimed = [];
  class FakeCache {
    constructor() { this.entries = new Map(); }
    async add(request) {
      const response = await worker.fetch(request);
      if (!response.ok) throw new TypeError("Bad status " + response.status);
      this.entries.set(request.url, response);
    }
    async put(key, response) { this.entries.set(new URL(key).href, response); }
    async match(key) { return this.entries.get(new URL(key).href)?.clone(); }
  }
  const worker = {
    fetch: (request, ...rest) => network(request, ...rest),
    stores,
    claimed,
    listeners,
    caches: {
      async open(name) {
        if (!stores.has(name)) stores.set(name, new FakeCache());
        return stores.get(name);
      },
      async keys() { return [...stores.keys()]; },
      async delete(name) { return stores.delete(name); }
    }
  };
  const context = {
    self: {
      location: new URL(ORIGIN + "/sw.js"),
      registration: { scope: ORIGIN + "/", showNotification() {} },
      clients: { claim: async () => { claimed.push(true); }, matchAll: async () => [], openWindow() {} },
      skipWaiting() {},
      addEventListener(type, listener) { listeners[type] = listener; }
    },
    caches: worker.caches,
    fetch: request => worker.fetch(request),
    Request: class extends Request {
      constructor(input, init) { super(typeof input === "string" ? new URL(input, ORIGIN + "/sw.js") : input, init); }
    },
    Response,
    URL,
    Promise,
    setTimeout: (callback, ms) => setTimeout(callback, ms / 1000),
    console
  };
  vm.runInNewContext(source, context);
  return worker;
}

// Dispatches an event the way the browser does, and waits for its work.
async function dispatch(worker, type, fields = {}) {
  const waits = [];
  let response = null;
  const event = { ...fields, waitUntil: promise => waits.push(promise), respondWith: promise => { response = promise; } };
  worker.listeners[type](event);
  const answer = response && await response;
  await Promise.all(waits);
  return { answered: response !== null, response: answer };
}

const fetchEvent = (path, { method = "GET", mode = "cors", clientId = "page-1", resultingClientId = "" } = {}) => ({
  request: { method, mode, url: path.startsWith("http") ? path : at(path) }, clientId, resultingClientId
});

const ok = text => new Response(text, { status: 200, headers: { "Content-Type": "text/plain" } });
// Node's Response can't say it was redirected or what type it is, so these stand in.
const asServed = response => Object.defineProperties(response, { type: { value: "basic" }, redirected: { value: false } });
const serve = files => request => {
  const path = new URL(request.url).pathname.slice(1) || "./";
  return path in files ? Promise.resolve(asServed(ok(files[path]))) : Promise.resolve(asServed(new Response("Not found", { status: 404 })));
};
const body = async response => response && await response.text();
const cacheOf = worker => worker.stores.get(/^const CACHE = "([^"]+)";$/m.exec(source)[1]);

test("installing stores each file, and one that fails doesn't stop the rest", async () => {
  const files = Object.fromEntries(shell.map(path => [path, "copy of " + path]));
  delete files["mark.svg"];
  const worker = startWorker({ network: serve(files) });
  await dispatch(worker, "install");
  const cache = cacheOf(worker);
  assert.equal(cache.entries.size, shell.length - 1);
  assert.equal(await body(await cache.match(at("app.mjs"))), "copy of app.mjs");
  assert.equal(await cache.match(at("mark.svg")), undefined);
});

test("activating deletes the caches of earlier versions and takes over open pages", async () => {
  const worker = startWorker();
  await worker.caches.open("baseline-shell-v0");
  await worker.caches.open("something-old");
  await dispatch(worker, "install");
  await dispatch(worker, "activate");
  assert.deepEqual(await worker.caches.keys(), [/^const CACHE = "([^"]+)";$/m.exec(source)[1]]);
  assert.equal(worker.claimed.length, 1);
});

test("the API, other sites, other methods and files that aren't the app's never pass through the worker", async () => {
  const worker = startWorker({ network: () => assert.fail("The worker fetched a request it should leave alone.") });
  for (const event of [
    fetchEvent("api/log"),
    fetchEvent("api/log", { method: "POST" }),
    fetchEvent("api/remind"),
    fetchEvent("api/log", { mode: "navigate" }),
    fetchEvent("https://enabling-duck-7464.clerk.accounts.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js"),
    fetchEvent("https://enabling-duck-7464.clerk.accounts.dev/v1/client?_clerk_js_version=6"),
    fetchEvent("./", { method: "POST", mode: "navigate" }),
    fetchEvent("app.mjs", { method: "HEAD" }),
    fetchEvent("app.mjs?v=2"),
    fetchEvent("fonts/OFL.txt"),
    fetchEvent("sw.js"),
    fetchEvent("settings", { mode: "navigate" })
  ]) {
    const { answered } = await dispatch(worker, "fetch", event);
    assert.equal(answered, false, event.request.method + " " + event.request.url + " " + event.request.mode);
  }
});

test("online, files come from the network and replace the copy", async () => {
  let version = "v1";
  const worker = startWorker({ network: request => serve(Object.fromEntries(shell.map(path => [path, version + " " + path])))(request) });
  await dispatch(worker, "install");
  version = "v2";
  const { response } = await dispatch(worker, "fetch", fetchEvent("app.mjs"));
  assert.equal(await body(response), "v2 app.mjs");
  assert.equal(await body(await cacheOf(worker).match(at("app.mjs"))), "v2 app.mjs");
});

test("offline, files and the page come from the copy, whatever the page's query string", async () => {
  let online = true;
  const files = Object.fromEntries(shell.map(path => [path, "copy of " + path]));
  const worker = startWorker({ network: request => online ? serve(files)(request) : Promise.reject(new TypeError("Failed to fetch")) });
  await dispatch(worker, "install");
  online = false;
  assert.equal(await body((await dispatch(worker, "fetch", fetchEvent("styles.css"))).response), "copy of styles.css");
  assert.equal(await body((await dispatch(worker, "fetch", fetchEvent("./?__clerk_handshake=1", { mode: "navigate" }))).response), "copy of ./");
  assert.equal(await body((await dispatch(worker, "fetch", fetchEvent("index.html", { mode: "navigate" }))).response), "copy of index.html");
  // With only one copy of the page, either name gets it.
  cacheOf(worker).entries.delete(at("index.html"));
  assert.equal(await body((await dispatch(worker, "fetch", fetchEvent("index.html", { mode: "navigate" }))).response), "copy of ./");
});

test("offline with no copy, the request fails as it would without the worker", async () => {
  const worker = startWorker();
  const { response } = await dispatch(worker, "fetch", fetchEvent("app.mjs"));
  assert.equal(response.type, "error");
});

test("an error page from the network falls back to the copy, and isn't stored", async () => {
  let status = 200;
  const worker = startWorker({ network: () => Promise.resolve(asServed(new Response(status === 200 ? "good" : "error page", { status }))) });
  await dispatch(worker, "fetch", fetchEvent("model.mjs"));
  status = 503;
  assert.equal(await body((await dispatch(worker, "fetch", fetchEvent("model.mjs"))).response), "good");
  assert.equal(await body(await cacheOf(worker).match(at("model.mjs"))), "good");
  // Without a copy, the error page is what there is.
  assert.equal(await body((await dispatch(worker, "fetch", fetchEvent("chart.mjs"))).response), "error page");
});

test("a slow network gives way to the copy, and its answer still replaces the copy", async () => {
  let release;
  const files = Object.fromEntries(shell.map(path => [path, "old " + path]));
  let slow = false;
  const worker = startWorker({ network: request => slow ? new Promise(resolve => { release = () => resolve(asServed(ok("new"))); }) : serve(files)(request) });
  await dispatch(worker, "install");
  slow = true;
  const waits = [];
  let response;
  worker.listeners.fetch({ ...fetchEvent("chart.mjs"), waitUntil: promise => waits.push(promise), respondWith: promise => { response = promise; } });
  assert.equal(await body(await response), "old chart.mjs");
  release();
  await Promise.all(waits);
  assert.equal(await body(await cacheOf(worker).match(at("chart.mjs"))), "new");
});

test("a page that opened from the copy gets its modules from the copy, so it never mixes versions", async () => {
  let online = false;
  const worker = startWorker({ network: request => online ? Promise.resolve(asServed(ok("new " + new URL(request.url).pathname))) : Promise.reject(new TypeError("Failed to fetch")) });
  const cache = await worker.caches.open(/^const CACHE = "([^"]+)";$/m.exec(source)[1]);
  for (const path of ["./", "app.mjs"]) await cache.put(at(path), ok("old " + path));
  assert.equal(await body((await dispatch(worker, "fetch", fetchEvent("./", { mode: "navigate", resultingClientId: "page-old" }))).response), "old ./");
  online = true;
  assert.equal(await body((await dispatch(worker, "fetch", fetchEvent("app.mjs", { clientId: "page-old" }))).response), "old app.mjs");
  // The network's answer is stored for the next load, and a page from the network gets it.
  assert.equal(await body((await dispatch(worker, "fetch", fetchEvent("app.mjs", { clientId: "page-new" }))).response), "new /app.mjs");
});
