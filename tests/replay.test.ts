import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appendModTag, cString, detectFormat, isModTag, MOD_TAG_MAX, parseReplay, readCommands, readModTag, REPLAY_ERRORS, ReplayError, stripModTag, type ModTag, type ReplayFormat } from "../src/index";
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

/** A command stream from raw frame blocks: `[frame, the block's bytes as hex]`, several commands to a block. */
function blocks(list: [frame: number, hex: string][]): Uint8Array {
  const out: number[] = [];
  for (const [frame, hex] of list) {
    const body = hex.match(/../g)!.map((b) => parseInt(b, 16));
    out.push(frame & 255, (frame >> 8) & 255, (frame >> 16) & 255, frame >>> 24, body.length, ...body);
  }
  return new Uint8Array(out);
}

describe("a mod's own commands", () => {
  // The command stream of a Cosmonarchy BW replay saved by the play page: its plugin sends type 0x63 with a body of
  // its own every game. Then one ordinary block: a select and a right click.
  const vanilla = [0x00, 0x09, 1, ...le16(5), 0x00, 0x14, ...le16(640), ...le16(320), ...le16(0), ...le16(228), 0];
  const commands = blocks([
    [2, "00630401ffffffffffffffffff00630201400c00000000000000"],
    [3, "006306ab519d83a309ee848978006306ab519d83a309ee848978006306ab519d83a309ee848978"],
    [5, "00630201400d5d000000000000"],
    [10, vanilla.map((b) => b.toString(16).padStart(2, "0")).join("")],
  ]);

  it("are unknown in a 1.16.1 replay, where 0x60–0x65 are not Remastered's", async () => {
    const r = await parseReplay(writeReplay({ format: "legacy", players, commands, chk: chk(64, 64) }));
    expect(r.unknownCommands).toBe(3);
    expect(r.commands.filter((c) => c.frame < 10)).toEqual([]);
    expect(r.commands.map((c) => [c.frame, c.kind])).toEqual([[10, "select"], [10, "rightClick"]]);
    expect(r.commands[0].tags).toEqual([5]);
    expect(r.commands[1]).toMatchObject({ x: 640, y: 320, unit: 228, queued: false });
  });

  it("read as Remastered's 1.21 commands in a 1.21 replay, and when no format is given", async () => {
    const r = await parseReplay(writeReplay({ format: "1.21", players, commands, chk: chk(64, 64) }));
    expect(r.commands[0]).toMatchObject({ frame: 2, kind: "select", type: 0x63 });
    expect(r.commands.slice(-2).map((c) => [c.frame, c.kind])).toEqual([[10, "select"], [10, "rightClick"]]);
    expect(readCommands(commands).commands[0]).toMatchObject({ frame: 2, kind: "select", type: 0x63 });
    expect(readCommands(commands, "legacy").unknown).toBe(3);
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

const mod: ModTag = {
  v: 1,
  dataSet: { hash: "0123456789abcdef", name: "Test Mod", url: "https://example.org/test-mod" },
  plugins: [{ name: "first.qdp", sha256: "a".repeat(64) }, { name: "second.qdp", sha256: "b".repeat(64) }],
  firegraft: { name: "Test Mod.fgp", sha256: "c".repeat(64) },
  noplugins: false,
  engine: { lifter: "m7s6.1", build: "d".repeat(16) },
  madeBy: "test 1.0.0",
};

/** A tagged section by hand: the id, the length, then `body`. */
function tagged(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  out.set(new TextEncoder().encode(id));
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** A raw section holding `data`, as `appendModTag` writes them (checksum not checked by the reader). */
const raw = (data: Uint8Array) => {
  const head = new Uint8Array(12);
  const dv = new DataView(head.buffer);
  dv.setUint32(4, 1, true);
  dv.setUint32(8, data.length, true);
  return concat(head, data);
};
const le32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
/** An SCMJ section around `json`, as the format frames it. */
const scmj = (json: string) => { const p = new TextEncoder().encode(json); return tagged("SCMJ", concat(raw(le32(p.length)), raw(p))); };

describe.each<ReplayFormat>(["legacy", "1.18", "1.21"])("a mod tag in a %s replay", (format) => {
  const plain = writeReplay({ format, players, commands: classic, chk: chk(64, 64, 4), cclr: format === "legacy" ? undefined : { 1: [1, 0.5, 0] } });

  it("is null when there is none", async () => {
    expect((await parseReplay(plain)).mod).toBeNull();
    expect(await readModTag(plain)).toBeNull();
    expect(await stripModTag(plain)).toBe(plain);
  });

  it("is written, read back, and changes nothing else", async () => {
    const bytes = await appendModTag(plain, mod);
    expect(detectFormat(bytes)).toBe(format);
    const before = await parseReplay(plain);
    const after = await parseReplay(bytes);
    expect(after.mod).toEqual(mod);
    expect({ ...after, mod: null }).toEqual(before);
    expect(await readModTag(bytes)).toEqual(mod);
    // The bytes before the section are the file's own; nothing after.
    expect(bytes.subarray(0, plain.length)).toEqual(plain);
    expect(String.fromCharCode(...bytes.subarray(plain.length, plain.length + 4))).toBe("SCMJ");
  });

  it("replaces the tag a file has, and strips it back to the file it was", async () => {
    const once = await appendModTag(plain, mod);
    const other = { ...mod, dataSet: { ...mod.dataSet, hash: "fedcba9876543210" } };
    const twice = await appendModTag(once, other);
    expect(twice.length).toBe(once.length);
    expect((await parseReplay(twice)).mod).toEqual(other);
    expect(await stripModTag(twice)).toEqual(plain);
  });

  it("is read when the test writer packs it the format's way", async () => {
    const bytes = writeReplay({ format, players, commands: classic, chk: chk(64, 64, 4), mod });
    expect((await parseReplay(bytes)).mod).toEqual(mod);
    expect(await stripModTag(bytes)).toEqual(writeReplay({ format, players, commands: classic, chk: chk(64, 64, 4) }));
  });

  it("reads and writes back a data set's races unchanged", async () => {
    const withRaces: ModTag = { ...mod, dataSet: { ...mod.dataSet, races: [{ id: 69, name: "Askosi", letter: "a", like: 1 }, { id: 70, name: "Bloodsummon" }] } };
    const bytes = await appendModTag(plain, withRaces);
    const read = (await parseReplay(bytes)).mod!;
    expect(read).toEqual(withRaces);
    expect(read.dataSet.races).toEqual([{ id: 69, name: "Askosi", letter: "a", like: 1 }, { id: 70, name: "Bloodsummon" }]);
    // Written again from what was read: the same bytes.
    expect(await appendModTag(bytes, read)).toEqual(bytes);
  });

  it("keeps fields it does not know", async () => {
    const later = { ...mod, v: 2, seed: 42, dataSet: { ...mod.dataSet, files: 37 } } as ModTag;
    expect((await parseReplay(await appendModTag(plain, later))).mod).toEqual(later);
  });

  it("is ignored, and the rest read, when it is damaged", async () => {
    const before = await parseReplay(plain);
    const good = JSON.stringify(mod);
    const damaged = [
      scmj(good.slice(0, -5)),                                         // cut short
      scmj("not JSON"),
      scmj(JSON.stringify({ ...mod, dataSet: { ...mod.dataSet, hash: "short" } })),
      scmj(JSON.stringify({ ...mod, plugins: [{ name: "x" }] })),
      scmj(JSON.stringify({ ...mod, noplugins: "no" })),
      scmj(JSON.stringify([mod])),
      tagged("SCMJ", raw(le32(5000))),                                 // a size and no payload
      tagged("SCMJ", new Uint8Array([1, 2, 3])),
      concat(new TextEncoder().encode("SCMJ"), le32(0xffff)),          // longer than the file
      new Uint8Array([0xff, 0xfe]),                                     // a byte string, not a section
    ];
    for (const tail of damaged) {
      const r = await parseReplay(concat(plain, tail));
      expect(r.mod).toBeNull();
      expect({ ...r, mod: null }).toEqual(before);
      expect(await readModTag(concat(plain, tail))).toBeNull();
    }
  });

  it("is found after a damaged one, and past sections it does not know", async () => {
    const bytes = concat(plain, tagged("Zzzz", new Uint8Array([9, 9])), scmj("{}"), scmj(JSON.stringify(mod)));
    expect((await parseReplay(bytes)).mod).toEqual(mod);
  });

  it("is refused when too long to write, or not of the shape", async () => {
    const long = { ...mod, plugins: Array.from({ length: 60 }, (_, i) => ({ name: `p${i}.qdp`, sha256: "e".repeat(64) })) };
    await expect(appendModTag(plain, long)).rejects.toBeInstanceOf(RangeError);
    await expect(appendModTag(plain, { ...mod, madeBy: 1 } as unknown as ModTag)).rejects.toBeInstanceOf(TypeError);
    await expect(appendModTag(new Uint8Array(100), mod)).rejects.toBeInstanceOf(ReplayError);
  });
});

describe("a mod tag in the wrong place", () => {
  it("is not found inside another section's data", async () => {
    // A chat line reading SCMJ and a whole section's bytes in the map: neither is a tagged section.
    const section = scmj(JSON.stringify(mod));
    const commands = cmds([[5, 0, 0x5c, 0, ...section.subarray(0, 79), 0]]);
    const map = concat(chk(64, 64), section);
    for (const format of ["legacy", "1.21"] as const) {
      const bytes = writeReplay({ format, players, commands, chk: map });
      expect((await parseReplay(bytes)).mod).toBeNull();
      expect(await readModTag(bytes)).toBeNull();
    }
  });

  it("is ignored where a Remastered file keeps its names, and the names are not read from it", async () => {
    const bytes = writeReplay({ format: "1.21", players, commands: cmds([]), chk: chk(64, 64) });
    // The writer ends a 1.21 file with the names section, then an Sbat section of 3 bytes (11 in all): find where the names start.
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const namesEnd = bytes.length - 11;
    let mapEnd = namesEnd - 12;
    while (mapEnd > 0 && !(dv.getUint32(mapEnd + 4, true) === 1 && mapEnd + 12 + dv.getUint32(mapEnd + 8, true) === namesEnd)) mapEnd--;
    const moved = concat(bytes.subarray(0, mapEnd), scmj(JSON.stringify(mod)));
    const r = await parseReplay(moved);
    expect(r.mod).toBeNull();
    expect(r.players.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
    // Writing a tag gives such a file an empty names section first, so the tag is where it is read.
    const fixed = await parseReplay(await appendModTag(moved, mod));
    expect(fixed.mod).toEqual(mod);
    expect(fixed.players.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("errors", () => {
  it("every ReplayError message is in REPLAY_ERRORS, and every one is distinct", () => {
    expect(new Set(REPLAY_ERRORS).size).toBe(REPLAY_ERRORS.length);
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const thrown = [...source.matchAll(/msg\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(thrown.length).toBeGreaterThan(0);
    for (const m of thrown) expect(REPLAY_ERRORS).toContain(m);
    // ReplayError is never made with a message that does not go through msg().
    expect(source.match(/new ReplayError\((?!msg\()/g)).toBeNull();
  });

  it("isModTag checks every field", () => {
    expect(isModTag(mod)).toBe(true);
    expect(isModTag({ ...mod, firegraft: null, engine: null, plugins: [], dataSet: { ...mod.dataSet, url: null } })).toBe(true);
    for (const k of Object.keys(mod)) {
      const { [k]: _, ...rest } = mod;
      void _;
      expect(isModTag(rest)).toBe(false);
    }
    expect(isModTag({ ...mod, dataSet: { ...mod.dataSet, hash: "0123456789ABCDEF" } })).toBe(false);
    expect(isModTag({ ...mod, v: 1.5 })).toBe(false);
    expect(new TextEncoder().encode(JSON.stringify(mod)).length).toBeLessThan(MOD_TAG_MAX);
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
      expect(r.mod).toBeNull();
    });

    it.each(reps)("%s takes a mod tag and gives it back, the rest read as before", async (name) => {
      const bytes = new Uint8Array(readFileSync(new URL(name, dir)));
      const before = await parseReplay(bytes);
      const tagged = await appendModTag(bytes, mod);
      const after = await parseReplay(tagged);
      expect(after.mod).toEqual(mod);
      expect({ ...after, mod: null }).toEqual(before);
      expect(await readModTag(tagged)).toEqual(mod);
      expect(await stripModTag(tagged)).toEqual(bytes);
      // The file's own bytes come first, untouched: the tag goes at the end of what the game wrote.
      expect(tagged.subarray(0, bytes.length)).toEqual(bytes);
    });
  });
}
