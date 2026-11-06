import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cString, detectFormat, parseReplay, REPLAY_ERRORS, ReplayError, type ReplayFormat } from "../src/index";
import { chk, cmds, le16, writeReplay } from "../src/write";

const players = [
  { index: 0, id: 0, race: 1, name: "Alpha", color: 0 },
  { index: 1, id: 1, race: 0, name: "Beta", color: 1 },
];

/** Text without StarCraft's control bytes (its colour codes). */
const plain = (s: string) => s.replace(/[\x00-\x1f]/g, "");

/** A scenario's size and tileset, from its DIM and ERA sections. */
function dims(bytes: Uint8Array): [number, number, number] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, tileset = 0;
  for (let at = 0; at + 8 <= bytes.length;) {
    const name = String.fromCharCode(...bytes.subarray(at, at + 4)), size = dv.getUint32(at + 4, true);
    if (name === "DIM ") { width = dv.getUint16(at + 8, true); height = dv.getUint16(at + 10, true); }
    if (name === "ERA ") tileset = dv.getUint16(at + 8, true) & 7;
    at += 8 + size;
  }
  return [width, height, tileset];
}

/** One of each command the reader knows, in the classic encodings. */
const classic = cmds([
  [10, 0, 0x09, 2, ...le16(5), ...le16(6)],                                  // select two
  [12, 0, 0x14, ...le16(640), ...le16(320), ...le16(0), ...le16(228), 0],     // right click on ground
  [20, 0, 0x15, ...le16(100), ...le16(200), ...le16(0), ...le16(228), 0x0e, 1], // attack-move, queued
  [30, 0, 0x0c, 0x1e, ...le16(10), ...le16(12), ...le16(109)],                // build a Supply Depot at (10, 12)
  [40, 0, 0x0c, 0x1e, ...le16(10), ...le16(12), ...le16(109)],                //   the same again
  [50, 0, 0x1f, ...le16(7)],                                                   // train an SCV
  [51, 0, 0x1f, ...le16(7)],                                                   //   and another
  [60, 1, 0x23, ...le16(37)],                                                  // morph a Zergling
  [70, 1, 0x32, 3],                                                            // upgrade 3
  [80, 1, 0x30, 5],                                                            // tech 5
  [90, 1, 0x58, ...le16(1000), ...le16(1100)],                                 // minimap ping
  [95, 1, 0x13, 0, 4],                                                         // hotkey
  [96, 1, 0x37, 1, 2, 3, 4, 5, 6],                                             // sync: skipped by length
  [100, 1, 0x5c, 1, ...new TextEncoder().encode("gg"), ...new Array(78).fill(0)], // chat from slot 1
  [110, 1, 0x57, 1],                                                           // leave
]);

describe.each<ReplayFormat>(["legacy", "1.18", "1.21"])("a %s replay", (format) => {
  const bytes = writeReplay({ format, frames: 120, players, commands: classic, chk: chk(64, 64, 4), mapName: "\u0007Test \u0006Map" });

  it("is recognised", () => {
    expect(detectFormat(bytes)).toBe(format);
  });

  it("reads the header, the players and the map", async () => {
    const r = await parseReplay(bytes);
    expect(r.format).toBe(format);
    expect(r.header.frames).toBe(120);
    expect(r.header.gameType).toBe(2);
    expect(r.header.started?.getTime()).toBe(1_700_000_000_000);
    expect(plain(r.header.mapName)).toBe("Test Map");
    expect(r.players.map((p) => [p.name, p.race, p.color])).toEqual([["Alpha", 1, "#f40404"], ["Beta", 0, "#0c48cc"]]);
    // Two melee players on one team are opponents.
    expect(r.players.map((p) => p.team)).toEqual([1, 2]);
    expect(dims(r.chk)).toEqual([64, 64, 4]);
  });

  it("reads every command", async () => {
    const r = await parseReplay(bytes);
    expect(r.unknownCommands).toBe(0);
    expect(r.commands.map((c) => c.kind)).toEqual([
      "select", "rightClick", "targeted", "build", "build", "train", "train", "morph", "upgrade", "tech", "ping", "hotkey", "system", "chat", "leave",
    ]);
    expect(r.commands[0].tags).toEqual([5, 6]);
    expect(r.commands[1]).toMatchObject({ x: 640, y: 320, unit: 228, queued: false });
    expect(r.commands[2]).toMatchObject({ x: 100, y: 200, order: 0x0e, queued: true });
    expect(r.commands[3]).toMatchObject({ x: 10, y: 12, unit: 109 });
    expect(r.commands[13]).toMatchObject({ player: 1, text: "gg" });
  });
});

describe("Remastered extras", () => {
  it("takes full names and CCLR colours, and steps over sections it does not know", async () => {
    const bytes = writeReplay({
      format: "1.21", players, commands: cmds([]), chk: chk(64, 64),
      names: { 0: "A much longer name than the header holds" },
      cclr: { 1: [1, 0.5, 0] },
    });
    const r = await parseReplay(bytes);
    expect(r.players[0].name).toBe("A much longer name than the header holds");
    expect(r.players[1].color).toBe("#ff8000");
  });

  it("reads the 1.21 commands, which carry an extra word", async () => {
    const commands = cmds([
      [5, 0, 0x60, ...le16(64), ...le16(96), ...le16(0), ...le16(0), ...le16(228), 0],
      [6, 0, 0x61, ...le16(64), ...le16(96), ...le16(0), ...le16(0), ...le16(228), 0x98, 0],
      [7, 0, 0x63, 1, ...le16(9), ...le16(0)],
      [8, 0, 0x62, ...le16(9), ...le16(0)],
    ]);
    const r = await parseReplay(writeReplay({ format: "1.21", players, commands, chk: chk(64, 64) }));
    expect(r.unknownCommands).toBe(0);
    expect(r.commands.map((c) => c.kind)).toEqual(["rightClick", "targeted", "select", "simple"]);
    expect(r.commands[1]).toMatchObject({ x: 64, y: 96, order: 0x98 });
    expect(r.commands[2].tags).toEqual([9]);
  });

  it("skips the rest of a frame block after a command it does not know, and keeps going", async () => {
    const commands = cmds([
      [5, 0, 0xee, 1, 2, 3],
      [6, 0, 0x1f, ...le16(7)],
    ]);
    const r = await parseReplay(writeReplay({ format: "1.18", players, commands, chk: chk(64, 64) }));
    expect(r.unknownCommands).toBe(1);
    expect(r.commands.map((c) => c.kind)).toEqual(["train"]);
  });
});

describe("files that are not replays", () => {
  it("are refused with a reason from REPLAY_ERRORS", async () => {
    const refused = async (bytes: Uint8Array) => { try { await parseReplay(bytes); } catch (e) { return e; } return null; };
    const none = await refused(new Uint8Array(100));
    expect(none).toBeInstanceOf(ReplayError);
    expect((none as Error).message).toBe("This is not a StarCraft replay.");
    const cut = await refused(writeReplay({ format: "1.21", players, commands: classic, chk: chk(64, 64) }).subarray(0, 200));
    expect(cut).toBeInstanceOf(ReplayError);
    expect(REPLAY_ERRORS).toContain((cut as Error).message);
  });
});

describe("text from before Remastered", () => {
  it("is UTF-8, else Korean when it reads as Korean, else Western", () => {
    const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0x41]);
    expect(cString(bytes(0x54, 0xc3, 0xab))).toBe("Të");
    expect(cString(bytes(0xc5, 0xf5, 0xc8, 0xa5))).toBe("투혼");
    // 0xEB 0x6E is not a Korean pair, so this is windows-1252's "rën".
    expect(cString(bytes(0x72, 0xeb, 0x6e))).toBe("rën");
  });
});

// Real replays, when there are some in fixtures/ (gitignored: nobody's games are committed).
const dir = new URL("../fixtures/", import.meta.url);
const reps = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".rep")) : [];
if (reps.length) {
  describe("replays in fixtures/", () => {
    it.each(reps)("%s reads through with every command known", async (name) => {
      const r = await parseReplay(new Uint8Array(readFileSync(new URL(name, dir))));
      expect(r.unknownCommands).toBe(0);
      expect(r.players.length).toBeGreaterThan(0);
      const [w, h] = dims(r.chk);
      expect(w * h).toBeGreaterThan(0);
    });
  });
}
