import { createPusher } from "../server/push.mjs";
import { isScheduleRun, sendReminders } from "../server/reminders.mjs";
import { createStore } from "../server/store.mjs";
import { logError } from "../server/log.mjs";

let store;
let send;

// Sends weigh-in reminders. Vercel Schedules calls it every hour (see the
// schedule in vercel.json). The schedule trigger makes this function private:
// it has no public URL, and only Vercel's scheduler can run it.
export default {
  async fetch(request) {
    if (!isScheduleRun(request)) return Response.json({ error: "Not a schedule run." }, { status: 400 });
    try {
      store ??= createStore();
      send ??= createPusher();
      // Counts only, without any account or device (see sendReminders).
      console.log("Reminders:", JSON.stringify(await sendReminders({ store, send })));
      return new Response(null, { status: 200 });
    } catch (error) {
      logError("The reminder run", error);
      return Response.json({ error: "The reminder run failed." }, { status: 500 });
    }
  }
};
