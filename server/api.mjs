import { parseOp } from "./ops.mjs";

const reply = (status, body, headers = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

// GET /api/log returns the signed-in user's log. POST /api/log applies one
// change (see ops.mjs) and returns the updated log.
export function createHandler({ verifyUser, getStore, now = () => new Date() }) {
  return async function handle(request) {
    if (request.method !== "GET" && request.method !== "POST") return reply(405, { error: "Method not allowed." }, { Allow: "GET, POST" });
    const userId = await verifyUser(request);
    if (!userId) return reply(401, { error: "Sign in to use your log." });
    let change = null;
    if (request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return reply(400, { error: "Send the change as JSON." }); }
      change = parseOp(body, now());
      if (!change) return reply(400, { error: "That change isn't valid." });
    }
    try {
      return reply(200, await getStore().run(userId, change));
    } catch (error) {
      console.error(error);
      return reply(500, { error: "Your log couldn't be reached. Try again." });
    }
  };
}
