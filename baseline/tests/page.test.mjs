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
  const sources = Object.fromEntries(await Promise.all(["app.mjs", "model.mjs", "chart.mjs", "account.mjs", "export.mjs", "importers.mjs", "import-worker.mjs", "auth.mjs", "config.mjs", "sw.js"].map(async name => [name, await read(name)])));
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

test("the first-run screen offers kg, lb and st, and its weight field has the inputs each needs", async () => {
  const firstRun = section(page, "first-run");
  assert.deepEqual([...firstRun.matchAll(/name="first-run-unit" value="(\w+)"/g)].map(match => match[1]), ["kg", "lb", "st"]);
  for (const suffix of ["", "-lb", "-unit"]) assert.match(firstRun, new RegExp('id="first-run-weight' + suffix + '"'), suffix);
  assert.match(firstRun, /<button class="button primary save-button" type="submit">Save</);
  assert.match(firstRun, /id="first-run-skip"[^>]*>Skip for now</);
  // Its field is in the unit picked there, so it isn't among the fields that follow the saved unit.
  const app = await read("app.mjs");
  assert.ok(!JSON.parse(/^const WEIGHT_FIELDS = (\[[^\]]*\]);$/m.exec(app)[1]).includes("first-run-weight"));
});

test("each form that saves a weigh-in has room for a question under the weight, in a live region", async () => {
  const app = await read("app.mjs");
  const forms = JSON.parse(/^const CHECKED_FIELDS = (\{[^}]*\});$/m.exec(app)[1].replace(/(\w+):/g, '"$1":'));
  assert.deepEqual(forms, { entry: "entry-weight", sheet: "sheet-weight", edit: "edit-weight" });
  for (const [form, field] of Object.entries(forms)) {
    const html = section(page, form + "-form");
    const check = html.indexOf('id="' + form + '-check"');
    assert.ok(check > html.indexOf('id="' + field + '-lb"'), form + ": under the weight");
    assert.ok(check < html.indexOf('type="submit"'), form + ": above Save");
    // The live region stays on the page while empty, so screen readers hear it fill.
    assert.doesNotMatch(html, new RegExp('id="' + form + '-check"[^>]*hidden'), form);
    assert.match(html, new RegExp('<p class="check-text" id="' + form + '-check-text" role="status"></p>'), form);
    assert.match(html, new RegExp('id="' + form + '-check-actions"[^>]*hidden'), form);
  }
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

test("the charts leave vertical swipes to the page, and note marks and weekends have a key in the legend", async () => {
  const css = await read("styles.css");
  const wrap = /^\.chart-wrap \{[^}]*\}/m.exec(css)[0];
  assert.match(wrap, /touch-action: pan-y;/, "a sideways drag scrubs, a vertical swipe scrolls");
  assert.match(css, /^#trend-chart \.note-mark \{ stroke: var\(--ink-3\);/m);
  assert.match(page, /<span id="legend-note" hidden><i class="key-note"><\/i>Note<\/span>/);
  // chart.mjs shows the weekend key while it shades weekends, in both color schemes.
  assert.match(page, /<span id="legend-weekend" hidden><i class="key-weekend"><\/i>Weekend<\/span>/);
  assert.equal([...css.matchAll(/--weekend: rgb\(/g)].length, 2);
  assert.match(css, /^#trend-chart \.weekend \{ fill: var\(--weekend\); \}/m);
  // The tooltips keep clear of the log bar, which must exist under that id.
  const app = await read("app.mjs");
  assert.equal([...app.matchAll(/Chart\(\{ cover: "log-bar" \}\)/g)].length, 2);
  assert.match(page, /id="log-bar"/);
});

test("the trend line's thin parts are dashed and lighter, in both color schemes", async () => {
  const css = await read("styles.css");
  const light = /^:root \{[^}]*\}/m.exec(css)[0];
  const dark = /@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*\}/.exec(css)[0];
  for (const scheme of [light, dark]) assert.match(scheme, /--accent-thin: #[0-9a-f]{6};/);
  const thin = /^#trend-chart \.avg-thin \{[^}]*\}/m.exec(css)[0];
  assert.match(thin, /stroke: var\(--accent-thin\);/);
  assert.match(thin, /stroke-dasharray: \d/);
  assert.match(css, /^#trend-chart \.avg-single\.thin \{ fill: var\(--accent-thin\); \}/m);
});

test("nothing the app says blames anyone for a break in weighing", async () => {
  // The welcome-back state after a break, and everything else, keeps to plain facts.
  for (const name of ["index.html", "app.mjs", "model.mjs"]) {
    const source = await read(name);
    assert.doesNotMatch(source, /\bmissed\b|\bstreaks?\b|\bfell off\b|\bback on track\b|\bdon[’']t give up\b/i, name);
  }
});

// The text a button shows, without its tags and the words only screen readers get.
const shownText = html => html.replace(/<span class="sr-only">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

test("every button's name for screen readers starts with the words it shows, so voice control finds it", () => {
  let checked = 0;
  for (const [, attributes, content] of page.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const label = /\baria-label="([^"]*)"/.exec(attributes)?.[1];
    const shown = shownText(content);
    if (!label || !shown) continue;
    checked++;
    assert.ok(label.startsWith(shown), "“" + label + "” should start with “" + shown + "”");
  }
  assert.ok(checked >= 2);
  // The chart's ranges read "14D", with the rest for screen readers, as the unit buttons do.
  const ranges = [...section(page, "ranges").matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(ranges.map(([, , content]) => shownText(content)), ["14D", "30D", "90D", "All"]);
  for (const [, attributes] of ranges) assert.doesNotMatch(attributes, /aria-label/);
  assert.deepEqual(ranges.map(([, , content]) => /<span class="sr-only">([^<]*)<\/span>/.exec(content)[1]), [" (last 14 days)", " (last 30 days)", " (last 90 days)", " dates"]);
});

test("hover styles apply only where there's a pointer that hovers, so a tap leaves no colour behind", async () => {
  const css = await read("styles.css");
  // Where each @media (hover: hover) block starts and ends.
  const blocks = [];
  for (const match of css.matchAll(/@media \(hover: hover\) \{/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth && end < css.length) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}") depth--;
      end++;
    }
    blocks.push([match.index, end]);
  }
  const rules = [...css.matchAll(/:hover\b/g)].map(match => match.index).filter(index => !/\/\*[^]*$/.test(css.slice(css.lastIndexOf("*/", index) + 1, index)));
  assert.ok(rules.length >= 10);
  for (const index of rules) {
    const line = css.slice(css.lastIndexOf("\n", index) + 1, css.indexOf("\n", index));
    assert.ok(blocks.some(([start, end]) => index > start && index < end), line);
  }
});

test("small controls get a 44px hit area, and removing the goal asks first", async () => {
  const css = await read("styles.css");
  const rule = /^:where\(([^)]*)\)::before \{([^}]*)\}/m.exec(css);
  assert.ok(rule, "the hit-area rule");
  for (const name of [".text-button", ".icon-button", ".small-button", ".unit-switch button", ".ranges button"]) assert.ok(rule[1].split(", ").includes(name), name);
  assert.match(rule[2], /inset: min\(0px, calc\(\(100% - 44px\) \/ 2\)\)/);
  // Remove goal opens a question in the dialog, as deleting a weigh-in does.
  const goal = section(page, "goal-dialog");
  assert.match(goal, /<div id="goal-confirm" hidden><p class="dialog-detail" id="goal-confirm-text">Remove your goal\? Your weigh-ins stay\.<\/p>/);
  assert.match(goal, /<button class="button secondary" type="button" id="keep-goal">Keep goal<\/button><button class="button danger" type="button" id="confirm-clear-goal">Remove goal<\/button>/);
});

test("Import sits beside Download on Your data, reads files on the device, and asks before undoing", async () => {
  const importAt = page.indexOf('id="import"');
  assert.ok(importAt > page.indexOf('id="data-view"') && importAt < page.indexOf('id="download-csv"'), "on Your data, next to Download");
  assert.equal(page.slice(importAt, page.indexOf('id="download-csv"')).match(/<section\b/g)?.length, 1, "the next section is Download or delete");
  const importSection = section(page, "import");
  assert.match(importSection, /Bring in weigh-ins from a CSV file or another app’s export\. You’ll see what will change before anything is saved\./);
  assert.match(importSection, /<input type="file" id="import-file" accept="\.csv,\.txt,\.json,\.xml,\.zip" multiple hidden>/);
  assert.match(importSection, /Dates already in your log keep their current weight\./);
  assert.match(section(page, "undo-import-dialog"), /id="confirm-undo-import">Undo import</);
  // Read by a worker from Baseline's own origin, which the Content Security Policy allows.
  const app = await read("app.mjs");
  assert.match(app, /new Worker\("\.\/import-worker\.mjs", \{ type: "module" \}\)/);
  assert.match(await read("import-worker.mjs"), /^import \{ ImportError, readImportFiles \} from "\.\/importers\.mjs";$/m);
  // Values from a file reach the page only as text.
  const code = app.slice(app.indexOf("// Import: weigh-ins from a file"), app.indexOf("let undoImportTarget"));
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML/);
});

// A WebP's size in pixels, from its header: lossy ("VP8 "), lossless ("VP8L")
// or extended ("VP8X", as Chromium writes one with a colour profile).
function webpSize(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (chunk === "VP8 ") return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  throw new Error("Not a WebP image: " + chunk);
}

test("the manifest describes Baseline for an install dialog, with a screenshot for phones and one for computers", async () => {
  const manifest = JSON.parse(await read("manifest.webmanifest"));
  assert.equal(manifest.lang, "en");
  assert.equal(manifest.dir, "ltr");
  assert.deepEqual(manifest.categories, ["health", "fitness"]);
  assert.equal(manifest.display, "standalone");
  // The launch screen's colour can't follow dark mode yet, so it stays the light theme's.
  assert.equal(manifest.background_color, "#fdfdf7");
  assert.equal(manifest.background_color, /<meta name="theme-color" content="([^"]+)" media="\(prefers-color-scheme: light\)">/.exec(page)[1]);
  assert.match(page, /stays the light paper in dark mode too/);
  assert.deepEqual(manifest.screenshots.map(shot => shot.form_factor), ["narrow", "wide"]);
  for (const shot of manifest.screenshots) {
    assert.match(shot.src, /^screenshots\/[\w-]+\.webp$/);
    assert.equal(shot.type, "image/webp");
    assert.ok(shot.label.length > 20, "a label, which is the screenshot's alt text");
    const bytes = await readFile(new URL(shot.src, dist));
    const [width, height] = webpSize(bytes);
    assert.equal(shot.sizes, width + "x" + height, shot.src);
    // Chrome's rules for its richer install dialog: 320 to 3840 pixels a side,
    // the long side at most 2.3 times the short one, tall for phones and wide for computers.
    for (const side of [width, height]) assert.ok(side >= 320 && side <= 3840, shot.src);
    assert.ok(Math.max(width, height) / Math.min(width, height) <= 2.3, shot.src);
    assert.equal(shot.form_factor === "wide", width > height, shot.src);
    assert.ok(bytes.length <= 150 * 1024, shot.src + " is " + Math.round(bytes.length / 1024) + " KB");
  }
});

test("on an iPhone or iPad Home Screen, the app has its name and the ordinary status bar, and no launch images", () => {
  assert.match(page, /<meta name="apple-mobile-web-app-title" content="Baseline">/);
  assert.match(page, /<meta name="apple-mobile-web-app-status-bar-style" content="default">/);
  assert.doesNotMatch(page, /apple-touch-startup-image"? href/);
});

test("the install hint is one quiet line above the account's, with Install and Not now", async () => {
  const footer = page.slice(page.indexOf('<footer class="app-footer">'), page.indexOf("</footer>"));
  assert.ok(footer.indexOf('id="install-hint"') < footer.indexOf('id="storage-status"'));
  assert.match(section(page, "install-hint"), /^<p class="install-hint" id="install-hint" hidden><span id="install-hint-text"><\/span> <span class="install-hint-actions"><button class="text-button" type="button" id="install-hint-install">Install<\/button><button class="text-button" type="button" id="install-hint-later">Not now<\/button><\/span>$/);
  const app = await read("app.mjs");
  assert.ok(app.includes('"Install Baseline to log in one tap and get reminders."'));
  assert.ok(app.includes('"Add Baseline to your Home Screen to log in one tap and get reminders: tap Share, then Add to Home Screen."'));
  // Chromium's own offer is held back for the line's Install button.
  assert.match(app, /addEventListener\("beforeinstallprompt", event => \{\n {2}event\.preventDefault\(\);\n {2}installPrompt = event;/);
  const css = await read("styles.css");
  assert.match(css, /^\.app-footer \{[^}]*color: var\(--ink-3\);/m);
});
