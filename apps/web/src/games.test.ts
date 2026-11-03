import { describe, expect, it } from "vitest";
import { clientGames, getClientGame } from "./games";

describe("getClientGame", () => {
  it("returns registered games", () => {
    expect(getClientGame("doodle-dash")).toBe(clientGames["doodle-dash"]);
  });

  it("returns undefined for unknown ids, including Object.prototype keys", () => {
    for (const id of ["nope", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(getClientGame(id)).toBeUndefined();
    }
  });
});
