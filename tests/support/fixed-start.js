// Tests start from the bare shop with fixed money, so a Snapshot in the DEV Starting Template
// area can't break them. Test files that load the game through Vite get their own copy of the
// game code, so pass that server in too.
import { BASIC_FIXTURES } from "../../js/logic/FixtureLayout.js";
import { useStartingTemplate } from "../../js/logic/StartingTemplate.js";

export const TEST_STARTING_TEMPLATE = Object.freeze({
  money: 1500,
  fixtures: BASIC_FIXTURES.map((entry) => ({ ...entry, rotation: 0 })),
});

/** @param {import("vite").ViteDevServer} [server] */
export async function useFixedStart(server) {
  useStartingTemplate(TEST_STARTING_TEMPLATE);
  if (server) {
    const loaded = await server.ssrLoadModule("/js/logic/StartingTemplate.js");
    loaded.useStartingTemplate(TEST_STARTING_TEMPLATE);
  }
}
