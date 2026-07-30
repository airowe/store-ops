import { describe, expect, it } from "vitest";
import { APP_STORE_GENRES, genreNameFor } from "./appStoreGenres.js";

/**
 * The genre id → display name map. Every pair here was verified against
 * Apple's own genre tree (the MZStoreServices `genres?id=36` endpoint), NOT
 * from memory: a WRONG name is strictly worse than no name, because a wrong
 * name is a FABRICATED label rendered as if measured. A miss must therefore
 * return undefined so the caller can omit the category entirely.
 */
describe("genreNameFor — verified Apple genre ids", () => {
  /** Top-level App Store categories, exactly as Apple names them. */
  const topLevel: Array<[string, string]> = [
    ["6000", "Business"],
    ["6001", "Weather"],
    ["6002", "Utilities"],
    ["6003", "Travel"],
    ["6004", "Sports"],
    ["6005", "Social Networking"],
    ["6006", "Reference"],
    ["6007", "Productivity"],
    ["6008", "Photo & Video"],
    ["6009", "News"],
    ["6010", "Navigation"],
    ["6011", "Music"],
    ["6012", "Lifestyle"],
    ["6013", "Health & Fitness"],
    ["6014", "Games"],
    ["6015", "Finance"],
    ["6016", "Entertainment"],
    ["6017", "Education"],
    ["6018", "Books"],
    ["6020", "Medical"],
    ["6021", "Magazines & Newspapers"],
    ["6022", "Catalogs"],
    ["6023", "Food & Drink"],
    ["6024", "Shopping"],
    ["6025", "Stickers"],
    ["6026", "Developer Tools"],
    ["6027", "Graphics & Design"],
  ];

  it.each(topLevel)("maps top-level genre %s to %s", (id, name) => {
    expect(genreNameFor(id)).toBe(name);
  });

  /** The Games sub-genres (7001-7019). Note Apple has NO 7010. */
  const gamesSubGenres: Array<[string, string]> = [
    ["7001", "Action"],
    ["7002", "Adventure"],
    ["7003", "Casual"],
    ["7004", "Board"],
    ["7005", "Card"],
    ["7006", "Casino"],
    ["7007", "Dice"],
    ["7008", "Educational"],
    ["7009", "Family"],
    ["7011", "Music"],
    ["7012", "Puzzle"],
    ["7013", "Racing"],
    ["7014", "Roleplaying"],
    ["7015", "Simulation"],
    ["7016", "Sports"],
    ["7017", "Strategy"],
    ["7018", "Trivia"],
    ["7019", "Word"],
  ];

  it.each(gamesSubGenres)("maps Games sub-genre %s to %s", (id, name) => {
    expect(genreNameFor(id)).toBe(name);
  });

  it("has no entry for 7010 — Apple does not define that id", () => {
    expect(genreNameFor("7010")).toBeUndefined();
  });

  it("returns undefined for an unknown id rather than inventing a label", () => {
    expect(genreNameFor("999999")).toBeUndefined();
    expect(genreNameFor("")).toBeUndefined();
  });

  it("returns undefined for a non-id string rather than echoing it back", () => {
    expect(genreNameFor("Health & Fitness")).toBeUndefined();
  });

  it("never maps an id to an empty or whitespace-only name", () => {
    for (const name of Object.values(APP_STORE_GENRES)) {
      expect(name.trim()).not.toBe("");
    }
  });
});
