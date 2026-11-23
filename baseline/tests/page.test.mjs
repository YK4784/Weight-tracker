import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { frontendApiFor } from "../dist/account.mjs";
import { CLERK_PUBLISHABLE_KEY } from "../dist/config.mjs";

const dist = new URL("../dist/", import.meta.url);
const read = name => readFile(new URL(name, dist), "utf8");
const page = await read("index.html");
const links = [...page.matchAll(/<link\b[^>]*>/g)].map(([tag]) => tag);

// The relative modules a module imports, by file name.
async function importsOf(name) {
  const source = await read(name);
  return [...source.matchAll(/^import\b[^;]*?\bfrom\s+"\.\/([^"]+)"/gm)].map(match => match[1]);
}

test("the page connects early to the Frontend API its publishable key names", () => {
  const preconnects = links.filter(tag => /\brel="preconnect"/.test(tag));
  assert.equal(preconnects.length, 1);
  assert.match(preconnects[0], /\bcrossorigin\b/);
  assert.equal(/\bhref="([^"]+)"/.exec(preconnects[0])[1], "https://" + frontendApiFor(CLERK_PUBLISHABLE_KEY));
});

test("every module app.mjs loads, directly or not, is preloaded", async () => {
  const preloaded = new Set(links.filter(tag => /\brel="modulepreload"/.test(tag)).map(tag => /\bhref="\.\/([^"]+)"/.exec(tag)[1]));
  const seen = new Set();
  const queue = ["app.mjs"];
  while (queue.length) {
    for (const name of await importsOf(queue.shift())) {
      if (seen.has(name)) continue;
      seen.add(name);
      queue.push(name);
    }
  }
  assert.ok(seen.size >= 5);
  assert.deepEqual([...seen].filter(name => !preloaded.has(name)), []);
  assert.deepEqual([...preloaded].filter(name => !seen.has(name)), []);
});
