// Reads the files chosen for an import off the page's thread (see
// readImportFiles in importers.mjs), so a large Apple Health export streams
// through without freezing the page. The page sends { files } and gets back
// { type: "progress", read, total } as an export streams in, then
// { type: "done", file } or { type: "error", message }.
import { ImportError, readImportFiles } from "./importers.mjs";

self.addEventListener("message", async event => {
  try {
    const file = await readImportFiles(event.data.files, { onProgress: ({ read, total }) => self.postMessage({ type: "progress", read, total }) });
    self.postMessage({ type: "done", file });
  } catch (error) {
    // Only Baseline's own messages reach the page. Anything else, such as a
    // file the browser couldn't read, gets a plain one.
    if (!(error instanceof ImportError)) console.error(error);
    self.postMessage({ type: "error", message: error instanceof ImportError ? error.message : "Baseline couldn’t read this file. Check that it’s a CSV, a JSON export or Apple Health’s export.xml, then try again." });
  }
});
