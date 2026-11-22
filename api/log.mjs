import { createHandler } from "../server/api.mjs";
import { createVerifier } from "../server/auth.mjs";
import { createStore } from "../server/store.mjs";

let store;

export default {
  fetch: createHandler({ verifyUser: createVerifier(), getStore: () => store ??= createStore() })
};
