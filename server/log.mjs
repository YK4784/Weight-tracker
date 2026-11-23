import { randomBytes } from "node:crypto";

// What the server writes to Vercel's logs about an error. An error's message,
// detail and parameters can carry the values a query was saving: a Postgres
// CHECK violation says "Failing row contains (…)", with the user ID, the
// weight and the note. So a log line names only the kind of error, its code
// (a Postgres SQLSTATE such as 23514, or a Node.js code such as ECONNRESET)
// and a short ID for the request, never a message, a value or an account.

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const CODE = /^[A-Za-z0-9_]{1,40}$/;

// A problem with the deployment's setup, such as a missing environment
// variable. Its code says which, since the log leaves out the message.
export class SetupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SetupError";
    this.code = code;
  }
}

// A short random ID that ties one request's log lines together.
export const requestId = () => randomBytes(4).toString("hex");

// The parts of `error` that are safe to log: its class name and its code.
// Anything that doesn't look like a plain name or code is left out, so a
// value can't get in through them either.
export function describeError(error) {
  const name = typeof error?.name === "string" && NAME.test(error.name) ? error.name : "Error";
  const code = typeof error?.code === "string" && CODE.test(error.code) ? error.code
    : typeof error?.code === "number" && Number.isInteger(error.code) ? String(error.code) : null;
  return code ? name + " " + code : name;
}

// Logs that `what` failed with `error`, as "[id] what failed: Name code".
// Returns the line, for tests.
export function logError(what, error, id = requestId()) {
  const line = "[" + id + "] " + what + " failed: " + describeError(error);
  console.error(line);
  return line;
}
