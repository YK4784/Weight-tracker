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

const policy = await read("health-data-privacy.html");
// The part of index.html with this id, up to its closing tag.
function section(html, id) {
  const start = html.indexOf('id="' + id + '"');
  assert.ok(start > 0, id);
  const open = html.lastIndexOf("<", start);
  const tag = /^<(\w+)/.exec(html.slice(open))[1];
  return html.slice(open, html.indexOf("</" + tag + ">", start));
}

test("the health data policy carries the version people agree to", async () => {
  const { CONSENT_VERSION } = await import("../dist/model.mjs");
  assert.equal(/<time id="policy-version" datetime="([^"]+)"/.exec(policy)?.[1], CONSENT_VERSION, "change the policy's date with CONSENT_VERSION");
  assert.match(policy, /<p class="policy-draft"><strong>Draft\.<\/strong>/, "marked as a draft until a lawyer has reviewed it");
});

test("the policy is linked from the sign-in screen, the consent step, Your data and the footer", () => {
  const link = /href="\.\/health-data-privacy\.html"/;
  for (const id of ["auth-note", "consent", "data-view"]) assert.match(section(page, id), link, id);
  const footer = page.slice(page.indexOf('<footer class="app-footer">'), page.indexOf("</footer>"));
  assert.match(footer, link);
  assert.match(footer, /href="#your-data"/);
});

test("the consent step's box starts unticked, with the wording people agree to", () => {
  const consent = section(page, "consent");
  assert.match(consent, /Baseline stores the weights, measurements and notes you enter so it can show your trend\. They’re kept private and never sold or used for ads\./);
  assert.match(consent, /I agree to Baseline storing my health data as described/);
  const box = /<input type="checkbox" id="consent-agree"[^>]*>/.exec(consent)[0];
  assert.doesNotMatch(box, /\bchecked\b/);
});

test("the pages run no outside code but Clerk's, and set no cookies", async () => {
  // The app's one script is its own; the policy has none.
  assert.deepEqual([...page.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag), ['<script type="module" src="./app.mjs">']);
  assert.doesNotMatch(policy, /<script\b/);
  const sources = Object.fromEntries(await Promise.all(["app.mjs", "model.mjs", "chart.mjs", "account.mjs", "export.mjs", "auth.mjs", "config.mjs", "sw.js"].map(async name => [name, await read(name)])));
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /document\.cookie|sendBeacon|XMLHttpRequest|new WebSocket|new EventSource|geolocation/, name);
    // The app talks only to its own API, and the worker only fetches what the page asked for.
    for (const [call] of source.matchAll(/\bfetch\([^)]*\)?/g)) assert.match(call, /^fetch\(("\/api\/log"|request\))/, name + ": " + call);
  }
  // Clerk's scripts come only from the Frontend API host the publishable key names.
  const loads = [...sources["auth.mjs"].matchAll(/loadScript\("([^"]*)" \+ (\w+) \+/g)].map(match => match[1] + match[2]);
  assert.deepEqual(loads, ["https://host", "https://host"]);
  assert.match(sources["auth.mjs"], /const host = frontendApiFor\(CLERK_PUBLISHABLE_KEY\)/);
});

test("every weight field has the pounds input and unit label that applyUnits sets up, the log sheet's included", async () => {
  const app = await read("app.mjs");
  const fields = JSON.parse(/^const WEIGHT_FIELDS = (\[[^\]]*\]);$/m.exec(app)[1]);
  assert.ok(fields.includes("entry-weight") && fields.includes("sheet-weight"));
  for (const id of fields) for (const suffix of ["", "-lb", "-unit"]) assert.match(page, new RegExp('id="' + id + suffix + '"'), id + suffix);
});

test("the log sheet saves from the keyboard, and the page can reach the safe area", () => {
  const sheet = section(page, "log-sheet");
  assert.match(sheet, /<dialog class="sheet" id="log-sheet"/);
  for (const id of ["sheet-weight", "sheet-weight-lb"]) assert.match(/<input id="[^"]+"[^>]*>/.exec(sheet.slice(sheet.indexOf('id="' + id + '"') - 7))[0], /\benterkeyhint="done"/, id);
  assert.match(sheet, /<button class="button primary save-button" type="submit"/);
  // env(safe-area-inset-bottom), which keeps the bar and the sheet above the home indicator, needs it.
  assert.match(page, /<meta name="viewport" content="[^"]*\bviewport-fit=cover\b[^"]*">/);
  assert.match(section(page, "log-bar"), /id="log-bar-button"[^>]*>Log today’s weight</);
});
