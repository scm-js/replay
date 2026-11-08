/**
 * Reading a StarCraft: Brood War replay (`.rep`).
 *
 * A replay does not record where units were. It records the game's setup (the header),
 * every command each player gave with the frame it was given on, and the map the game was
 * played on — the game re-runs the simulation from those to play it back. This module
 * reads all three and nothing more. It runs in browsers and in Node (18 or newer), and
 * depends on mopaq for the PKWARE packing of older replays.
 *
 * The file is a run of sections. Each is a checksum, a chunk count and the chunks, each
 * chunk a length and its bytes; a section's data is its chunks joined. How a chunk is
 * packed depends on the game version that wrote the file:
 *
 *   - before 1.18 ("legacy"): PKWARE DCL implode, except a chunk whose length is already
 *     its unpacked size, which is stored as is. Four sections: the replay id, the header,
 *     the commands and the map.
 *   - 1.18 to 1.20: zlib, a chunk being packed when it starts with a zlib header. After
 *     the four comes a player-names section, then sections tagged with a four-character
 *     id (`SKIN`, `LMTS`, `BFIX`, `CCLR`, `GCFG`, and whatever a third party adds).
 *   - 1.21 on: as 1.18, the replay id reading `seRS` instead of `reRS`, and a four-byte
 *     value between the replay id and the header.
 *
 * The commands and map sections are variable in size: each is preceded by a four-byte
 * section of its own holding the size.
 *
 * A tagged section is the four-character id, the length in bytes of what follows, then
 * framed sections. scmJS adds one of its own, `SCMJ`, which says which mod a game was
 * played with (`ModTag`): a four-byte section holding the size, then the size's bytes of
 * UTF-8 JSON. It may follow the map section of a legacy file directly, as 1.16's own
 * loader reads nothing past the map.
 *
 * The layout follows screp (github.com/icza/screp, Apache-2.0), the reference replay
 * parser, which in turn follows BWHF and bwreplib.
 */
import { explode } from "mopaq";

export type ReplayFormat = "legacy" | "1.18" | "1.21";

export interface ReplayPlayer {
  /** 0–11: where the player's record sits in the header, which is the map's player number. */
  index: number;
  /** The lobby slot id; chat names its sender by this. */
  slot: number;
  /** The id commands carry (`Command.player`). */
  id: number;
  /** 1 computer, 2 human, … as the map's OWNR byte. */
  type: number;
  /** 0 Zerg, 1 Terran, 2 Protoss. */
  race: number;
  team: number;
  name: string;
  /** `#rrggbb`, from the replay's own colour for the slot. */
  color: string;
}

export interface ReplayHeader {
  /** 0 StarCraft, 1 Brood War. */
  engine: number;
  /** The game's length in frames; a frame is 42 ms at Fastest. */
  frames: number;
  /** When the game started, or null when the header says 0. */
  started: Date | null;
  title: string;
  mapWidth: number;
  mapHeight: number;
  /** 0 Slowest … 6 Fastest. */
  speed: number;
  /** 2 Melee, 3 FFA, 4 1on1, 10 Use Map Settings, 15 Top vs Bottom, … */
  gameType: number;
  host: string;
  mapName: string;
}

/** What a command is, as far as this reader tells them apart; `type` keeps the game's own byte. */
export type CommandKind =
  | "select" | "hotkey" | "rightClick" | "targeted" | "build" | "land" | "liftOff"
  | "train" | "morph" | "buildingMorph" | "upgrade" | "tech" | "cancel" | "simple"
  | "leave" | "ping" | "chat" | "alliance" | "vision" | "system";

export interface Command {
  frame: number;
  /** The issuing player's id (`ReplayPlayer.id`). */
  player: number;
  kind: CommandKind;
  /** The command's type byte. */
  type: number;
  /** Map pixels for clicks and pings; tiles for `build` and `land`. */
  x?: number;
  y?: number;
  /** A units.dat id: what was built, trained or clicked on; 228 (None) for ground. */
  unit?: number;
  /** An orders.dat id, for `targeted`, `build` and `land`. */
  order?: number;
  queued?: boolean;
  /** An upgrade or tech id, a leave reason, a hotkey group. */
  value?: number;
  /** Units named in a `select`, as the game's unit tags. */
  tags?: number[];
  /** A `chat` line. */
  text?: string;
}

export interface Replay {
  format: ReplayFormat;
  header: ReplayHeader;
  /** The players who took part, in slot order. */
  players: ReplayPlayer[];
  commands: Command[];
  /** Commands whose type the reader did not know; the rest of their frame block is skipped. */
  unknownCommands: number;
  /** The map the game was played on, as a bare `scenario.chk`. */
  chk: Uint8Array;
  /** The mod the game was played with, from the replay's `SCMJ` section; null for a game of the unmodified game. */
  mod: ModTag | null;
}

/** A file that ran in the game, by name and the SHA-256 of its bytes (64 lowercase hex digits). */
export interface ModFile {
  name: string;
  sha256: string;
  [key: string]: unknown;
}

/**
 * What a replay's `SCMJ` section says about the mod a game was played with. Fields this
 * version does not know are kept as they were read.
 */
export interface ModTag {
  /** The format's version: 1. */
  v: number;
  /**
   * The data set: the files that differ from the game's own. `hash` is 16 lowercase hex
   * digits, the first of the SHA-256 over the sorted `name\tsha256` lines of those files;
   * `url` the makers' page, or null.
   */
  dataSet: { hash: string; name: string; url: string | null; [key: string]: unknown };
  /** The plugins that ran, in the order they were loaded; empty for none. */
  plugins: ModFile[];
  /** The FireGraft patch that was applied, if one was. */
  firegraft: ModFile | null;
  /** True when the game was played without the mod's plugins. */
  noplugins: boolean;
  /** The engine that played the game: the lifter's version and the build's hash, or null when not known. */
  engine: { lifter: string; build: string; [key: string]: unknown } | null;
  /** The program that wrote the section, such as `scm-sim 0.16.0`. */
  madeBy: string;
  [key: string]: unknown;
}

/** The largest `SCMJ` payload `appendModTag` writes, in bytes of JSON. */
export const MOD_TAG_MAX = 4096;

/** A reason the file cannot be read: its message is one of `REPLAY_ERRORS`, in English. */
export class ReplayError extends Error {}

/**
 * Every message a `ReplayError` can carry, for an app that shows them translated: look the message up in its own
 * catalogue. They change only in a major version.
 */
export const REPLAY_ERRORS = [
  "This is not a StarCraft replay.",
  "The file ends in the middle of a section.",
  "A section claims more chunks than a replay can hold.",
  "A section holds more than its stated size.",
  "A section's data does not unpack.",
  "A section's size is missing.",
  "A section claims to be larger than any replay.",
  "The replay's header is too short.",
] as const;

const msg = (text: (typeof REPLAY_ERRORS)[number]) => text;

/** A frame at Fastest: 1000 / 24 ms, as the game rounds it. */
export const FRAME_MS = 42;

/* ── Section framing ────────────────────────────────────── */

const CHUNK = 0x2000;

type Inflate = (chunk: Uint8Array) => Promise<Uint8Array>;

/** zlib (RFC 1950) through the platform's DecompressionStream — the browser's and Node's. */
export async function inflate(chunk: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([chunk as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class Reader {
  pos = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) { this.b = b; }
  get left(): number { return this.b.length - this.pos; }
  u32(): number {
    if (this.pos + 4 > this.b.length) throw new ReplayError(msg("The file ends in the middle of a section."));
    const v = (this.b[this.pos] | (this.b[this.pos + 1] << 8) | (this.b[this.pos + 2] << 16) | (this.b[this.pos + 3] << 24)) >>> 0;
    this.pos += 4;
    return v;
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.b.length) throw new ReplayError(msg("The file ends in the middle of a section."));
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

function isZlib(c: Uint8Array): boolean {
  return c.length > 4 && c[0] === 0x78 && ((c[0] << 8) | c[1]) % 31 === 0;
}

/** One framed section of `size` unpacked bytes. */
async function section(r: Reader, size: number, format: ReplayFormat, unzip: Inflate): Promise<Uint8Array> {
  if (size === 0) return new Uint8Array(0);
  r.u32(); // checksum — the game's, not checked here
  const count = r.u32();
  if (count > 0x10000) throw new ReplayError(msg("A section claims more chunks than a replay can hold."));
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < count; i++) chunks.push(r.bytes(r.u32()));

  if (format === "legacy") {
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      const want = Math.min(size - at, CHUNK);
      if (want <= 0) throw new ReplayError(msg("A section holds more than its stated size."));
      if (c.length === want) out.set(c, at);
      else {
        let unpacked: Uint8Array;
        try { unpacked = explode(c, want); } catch { throw new ReplayError(msg("A section's data does not unpack.")); }
        out.set(unpacked.subarray(0, want), at);
      }
      at += want;
    }
    return out;
  }

  const parts = await Promise.all(chunks.map((c) => (isZlib(c) ? unzip(c) : Promise.resolve(c))));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function sized(r: Reader, format: ReplayFormat, unzip: Inflate): Promise<Uint8Array> {
  const head = await section(r, 4, format, unzip);
  if (head.length < 4) throw new ReplayError(msg("A section's size is missing."));
  const size = (head[0] | (head[1] << 8) | (head[2] << 16) | (head[3] << 24)) >>> 0;
  if (size > 64 << 20) throw new ReplayError(msg("A section claims to be larger than any replay."));
  return section(r, size, format, unzip);
}

export function detectFormat(b: Uint8Array): ReplayFormat | null {
  if (b.length < 30) return null;
  const id = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (id === "seRS") return "1.21";
  if (id !== "reRS") return null;
  return b[28] === 0x78 ? "1.18" : "legacy";
}

/* ── Strings ────────────────────────────────────────────── */

function cut(b: Uint8Array): Uint8Array {
  const end = b.indexOf(0);
  return end < 0 ? b : b.subarray(0, end);
}

const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const utf8 = new TextDecoder("utf-8");
let legacy: { korean: TextDecoder | null; western: TextDecoder | null } | undefined;

function decoder(label: string, fatal: boolean): TextDecoder | null {
  try { return new TextDecoder(label, { fatal }); } catch { return null; }
}

/**
 * A zero-terminated string. Remastered writes UTF-8. Older clients wrote the host's code
 * page, which the file does not name: UTF-8 when it is valid, else Korean (cp949, by far
 * the most common other one) when it is valid, else Western (windows-1252), which takes
 * any bytes — the order broodrep settled on.
 */
export function cString(b: Uint8Array, alwaysUtf8 = false): string {
  const s = cut(b);
  if (alwaysUtf8) return utf8.decode(s);
  try { return utf8Strict.decode(s); } catch { /* not UTF-8 */ }
  legacy ??= { korean: decoder("euc-kr", true), western: decoder("windows-1252", false) };
  if (legacy.korean) {
    try { return legacy.korean.decode(s); } catch { /* not Korean */ }
  }
  return (legacy.western ?? utf8).decode(s);
}

/* ── Header ─────────────────────────────────────────────── */

/** The game's player colours by id (`screp`'s table), used when the replay has no CCLR. */
const COLORS = [
  0xf40404, 0x0c48cc, 0x2cb494, 0x88409c, 0xf88c14, 0x703014, 0xcce0d0, 0xfcfc38,
  0x088008, 0xfcfc7c, 0xecc4b0, 0x4068d4, 0x74a47c, 0x9090b8, 0xfcfc7c, 0x00e4fc,
  0xffc4e4, 0x787800, 0xd2f53c, 0x0000e6, 0x4068d4, 0xf032e6, 0x808080, 0x3c3c3c,
];

const hex = (rgb: number) => "#" + rgb.toString(16).padStart(6, "0");

function readHeader(d: Uint8Array, format: ReplayFormat): { header: ReplayHeader; slots: ReplayPlayer[] } {
  if (d.length < 0x279) throw new ReplayError(msg("The replay's header is too short."));
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const text = (at: number, n: number, utf = false) => cString(d.subarray(at, at + n), utf);
  const started = dv.getUint32(0x08, true);
  const header: ReplayHeader = {
    engine: d[0x00],
    frames: dv.getUint32(0x01, true),
    started: started ? new Date(started * 1000) : null,
    // Remastered writes UTF-8 and cuts a long title mid-character, so it is read leniently.
    title: text(0x18, 28, format !== "legacy"),
    mapWidth: dv.getUint16(0x34, true),
    mapHeight: dv.getUint16(0x36, true),
    speed: d[0x3a],
    gameType: dv.getUint16(0x3c, true),
    host: text(0x48, 24),
    mapName: text(0x61, 26),
  };
  const slots: ReplayPlayer[] = [];
  for (let i = 0; i < 12; i++) {
    const at = 0xa1 + i * 36;
    const color = i < 8 ? dv.getUint32(0x251 + i * 4, true) : -1;
    slots.push({
      index: i,
      slot: dv.getUint16(at, true),
      id: d[at + 4],
      type: d[at + 8],
      race: d[at + 9],
      team: d[at + 10],
      name: text(at + 11, 25),
      color: color >= 0 && color < COLORS.length ? hex(COLORS[color]) : "#9aa4b2",
    });
  }
  return { header, slots };
}

/* ── Commands ───────────────────────────────────────────── */

/** Game commands that carry nothing after the type byte: carrier and reaver stop, stim, merge archon … */
const EMPTY = new Set([0x1b, 0x1c, 0x1d, 0x27, 0x2a, 0x36, 0x5a]);
/** Cancels that name nothing: build, morph, nuke, tech, upgrade, addon. */
const CANCELS = new Set([0x18, 0x19, 0x2e, 0x31, 0x33, 0x34]);
/** Lobby and session commands with no payload: keep-alive, pause, resume, start game … */
const SESSION = new Set([0x05, 0x08, 0x10, 0x11, 0x38, 0x39, 0x3c, 0x54, 0x5b]);
/** Types whose payload is skipped, by length. */
const SKIP: Record<number, number> = {
  0x37: 6, 0x3a: 1, 0x3b: 1, 0x3d: 1, 0x3e: 5, 0x3f: 7, 0x40: 17, 0x41: 2, 0x42: 1, 0x43: 1,
  0x44: 2, 0x45: 2, 0x48: 12, 0x56: 9, 0x55: 1,
};
/** Types that are one "queued" byte: stop, burrow, return cargo, hold, unload all, siege, cloak … */
const QUEUEABLE = new Set([0x1a, 0x1e, 0x21, 0x22, 0x25, 0x26, 0x28, 0x2b, 0x2c, 0x2d]);

/** The order a Build command carries when it is really a Terran building landing. */
const ORDER_LAND = 0x47;

export function readCommands(d: Uint8Array): { commands: Command[]; unknown: number } {
  const commands: Command[] = [];
  let unknown = 0;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let p = 0;
  const u8 = () => d[p++];
  const u16 = () => { const v = dv.getUint16(p, true); p += 2; return v; };
  const u32 = () => { const v = dv.getUint32(p, true); p += 4; return v; };

  while (p + 5 <= d.length) {
    const frame = u32();
    const end = Math.min(d.length, p + 1 + d[p]);
    p++;
    while (p + 2 <= end) {
      const player = u8();
      const type = u8();
      const at = { frame, player, type };
      try {
        switch (type) {
          case 0x14: case 0x60: { // right click (1.21 adds a word after the tag)
            const x = u16(), y = u16();
            u16(); if (type === 0x60) u16();
            commands.push({ ...at, kind: "rightClick", x, y, unit: u16(), queued: u8() !== 0 });
            break;
          }
          case 0x15: case 0x61: { // targeted order
            const x = u16(), y = u16();
            u16(); if (type === 0x61) u16();
            const unit = u16(), order = u8();
            commands.push({ ...at, kind: "targeted", x, y, unit, order, queued: u8() !== 0 });
            break;
          }
          case 0x09: case 0x0a: case 0x0b: case 0x63: case 0x64: case 0x65: {
            const n = u8();
            const tags: number[] = [];
            for (let i = 0; i < n; i++) { tags.push(u16()); if (type >= 0x63) u16(); }
            commands.push({ ...at, kind: "select", tags });
            break;
          }
          case 0x13: { const kind = u8(); commands.push({ ...at, kind: "hotkey", value: u8(), order: kind }); break; }
          case 0x1f: commands.push({ ...at, kind: "train", unit: u16() }); break;
          case 0x23: commands.push({ ...at, kind: "morph", unit: u16() }); break;
          case 0x35: commands.push({ ...at, kind: "buildingMorph", unit: u16() }); break;
          case 0x0c: {
            const order = u8(), x = u16(), y = u16(), unit = u16();
            commands.push({ ...at, kind: order === ORDER_LAND ? "land" : "build", order, x, y, unit });
            break;
          }
          case 0x2f: { const x = u16(), y = u16(); commands.push({ ...at, kind: "liftOff", x, y }); break; }
          case 0x30: commands.push({ ...at, kind: "tech", value: u8() }); break;
          case 0x32: commands.push({ ...at, kind: "upgrade", value: u8() }); break;
          case 0x20: u16(); commands.push({ ...at, kind: "cancel" }); break;
          case 0x29: u16(); commands.push({ ...at, kind: "simple" }); break;
          case 0x62: u16(); u16(); commands.push({ ...at, kind: "simple" }); break;
          case 0x57: commands.push({ ...at, kind: "leave", value: u8() }); break;
          case 0x58: { const x = u16(), y = u16(); commands.push({ ...at, kind: "ping", x, y }); break; }
          case 0x5c: {
            const sender = u8();
            const text = cString(d.subarray(p, p + 80));
            p += 80;
            commands.push({ ...at, player: sender, kind: "chat", text });
            break;
          }
          case 0x0d: commands.push({ ...at, kind: "vision", value: u16() }); break;
          case 0x0e: commands.push({ ...at, kind: "alliance", value: u32() }); break;
          case 0x0f: u8(); commands.push({ ...at, kind: "system" }); break;
          case 0x12: u32(); commands.push({ ...at, kind: "system" }); break;
          case 0x06: case 0x07: p += u32(); commands.push({ ...at, kind: "system" }); break;
          default:
            if (QUEUEABLE.has(type)) commands.push({ ...at, kind: "simple", queued: u8() !== 0 });
            else if (EMPTY.has(type)) commands.push({ ...at, kind: "simple" });
            else if (CANCELS.has(type)) commands.push({ ...at, kind: "cancel" });
            else if (SESSION.has(type)) commands.push({ ...at, kind: "system" });
            else if (type in SKIP) { p += SKIP[type]; commands.push({ ...at, kind: "system" }); }
            else { unknown++; p = end; }
        }
      } catch {
        // A block that runs off the data: keep what was read.
        unknown++;
        p = end;
      }
    }
    p = end;
  }
  return { commands, unknown };
}

/* ── Mod identity ───────────────────────────────────────── */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFile = (v: unknown): v is ModFile => isObject(v) && typeof v.name === "string" && typeof v.sha256 === "string" && /^[0-9a-f]{64}$/.test(v.sha256);

/** Whether `value` has the shape of a `ModTag`: every field present and of its type. */
export function isModTag(value: unknown): value is ModTag {
  if (!isObject(value)) return false;
  const { v, dataSet, plugins, firegraft, noplugins, engine, madeBy } = value;
  return typeof v === "number" && Number.isInteger(v) && v >= 1
    && isObject(dataSet) && typeof dataSet.hash === "string" && /^[0-9a-f]{16}$/.test(dataSet.hash)
    && typeof dataSet.name === "string" && (dataSet.url === null || typeof dataSet.url === "string")
    && Array.isArray(plugins) && plugins.every(isFile)
    && (firegraft === null || isFile(firegraft))
    && typeof noplugins === "boolean"
    && (engine === null || (isObject(engine) && typeof engine.lifter === "string" && typeof engine.build === "string"))
    && typeof madeBy === "string";
}

/** An `SCMJ` section's bytes after the length: the payload's size, then the payload. Damage of any kind reads as null. */
async function readModBody(body: Uint8Array, format: ReplayFormat, unzip: Inflate): Promise<ModTag | null> {
  try {
    const payload = await sized(new Reader(body), format, unzip);
    if (payload.length > 0x10000) return null;
    const value: unknown = JSON.parse(utf8Strict.decode(payload));
    return isModTag(value) ? value : null;
  } catch {
    return null;
  }
}

/* ── The whole file ─────────────────────────────────────── */

const tag = (s: string) => (s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)) >>> 0;
/** Remastered's tagged sections and their unpacked sizes. */
const TAGGED: Record<number, number> = {
  [tag("SKIN")]: 0x15e0, [tag("LMTS")]: 0x1c, [tag("BFIX")]: 0x08, [tag("CCLR")]: 0xc0, [tag("GCFG")]: 0x19,
};
const SCMJ = tag("SCMJ");

const u32At = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

interface Tagged {
  kind: number;
  /** Where the tag's id is. */
  start: number;
  /** Where the section's data starts and ends: after the id and length, and that length on. */
  body: number;
  end: number;
}

/** The tagged sections from `r`'s position, as far as they are whole; `r` is left after the last. */
function taggedRun(r: Reader): Tagged[] {
  const out: Tagged[] = [];
  while (r.left >= 8) {
    const start = r.pos;
    const kind = r.u32();
    const raw = r.u32();
    if (raw > r.left) { r.pos = start; break; }
    out.push({ kind, start, body: r.pos, end: r.pos + raw });
    r.pos += raw;
  }
  return out;
}

/** Where the four classic sections, the names and the tagged sections of a file lie. */
interface Layout {
  format: ReplayFormat;
  /** The end of the map section. */
  mapEnd: number;
  /** The start of the tagged run: the end of the names section (Remastered) or of the map (legacy); -1 when a Remastered file has no names section that reads. */
  runStart: number;
  tagged: Tagged[];
  /** Where the whole tagged sections end; anything after is not read. */
  runEnd: number;
}

/** A tagged section's id at `r`'s position, where Remastered keeps its player names: a section in the wrong place. */
const tagHere = (r: Reader) => r.left >= 4 && (u32At(r.b, r.pos) === SCMJ || u32At(r.b, r.pos) in TAGGED);

async function layout(bytes: Uint8Array, unzip: Inflate): Promise<Layout> {
  const format = detectFormat(bytes);
  if (!format) throw new ReplayError(msg("This is not a StarCraft replay."));
  const r = new Reader(bytes);
  await section(r, 4, format, unzip);
  if (format === "1.21") r.u32();
  await section(r, 0x279, format, unzip);
  await sized(r, format, unzip);
  await sized(r, format, unzip);
  const mapEnd = r.pos;
  let runStart = mapEnd;
  if (format !== "legacy") {
    runStart = -1;
    if (r.left > 0 && !tagHere(r)) {
      try { await section(r, 0x300, format, unzip); runStart = r.pos; } catch { r.pos = mapEnd; }
    }
  }
  const tagged = runStart < 0 ? [] : taggedRun(r);
  return { format, mapEnd, runStart, tagged, runEnd: runStart < 0 ? mapEnd : r.pos };
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

let crcTable: Uint32Array | undefined;
/** A section's checksum as the game writes it: CRC-32 from 0xFFFFFFFF, without the final inversion. */
function checksum(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

/** A section of one chunk stored as is, which every version reads: a chunk as long as its data is not packed. */
const rawSection = (data: Uint8Array) => join([le32(checksum(data)), le32(1), le32(data.length), data]);

/** The whole `SCMJ` section: id, length, then the payload's size and the payload, each a raw section. */
function modSection(mod: ModTag): Uint8Array {
  if (!isModTag(mod)) throw new TypeError("The mod tag is missing a field, or has one of the wrong type.");
  const payload = new TextEncoder().encode(JSON.stringify(mod));
  if (payload.length > MOD_TAG_MAX) throw new RangeError(`The mod tag is ${payload.length} bytes of JSON; the most is ${MOD_TAG_MAX}.`);
  const body = join([rawSection(le32(payload.length)), rawSection(payload)]);
  return join([le32(SCMJ), le32(body.length), body]);
}

/** The replay's `SCMJ` section, or null when it has none or the one it has is damaged. */
export async function readModTag(bytes: Uint8Array, unzip: Inflate = inflate): Promise<ModTag | null> {
  let l: Layout;
  try { l = await layout(bytes, unzip); } catch { return null; }
  for (const t of l.tagged) {
    if (t.kind !== SCMJ) continue;
    const mod = await readModBody(bytes.subarray(t.body, t.end), l.format, unzip);
    if (mod) return mod;
  }
  return null;
}

/** The replay without its `SCMJ` sections; the same array when it has none. Rejects with a `ReplayError` when the file is not a replay. */
export async function stripModTag(bytes: Uint8Array, unzip: Inflate = inflate): Promise<Uint8Array> {
  const l = await layout(bytes, unzip);
  const ours = l.tagged.filter((t) => t.kind === SCMJ);
  if (!ours.length) return bytes;
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const t of ours) { parts.push(bytes.subarray(at, t.start)); at = t.end; }
  parts.push(bytes.subarray(at));
  return join(parts);
}

/**
 * The replay with `mod` as its `SCMJ` section, in place of any it had: at the end of the
 * tagged sections, which is the end of the file for any replay the game wrote. Rejects with
 * a `ReplayError` when the file is not a replay, a `TypeError` when `mod` is not a `ModTag`
 * and a `RangeError` when its JSON is longer than `MOD_TAG_MAX`. The section is not packed,
 * so this needs no compressor and runs in a browser.
 */
export async function appendModTag(bytes: Uint8Array, mod: ModTag, unzip: Inflate = inflate): Promise<Uint8Array> {
  const ours = modSection(mod);
  const l = await layout(bytes, unzip);
  if (l.runStart < 0) {
    // A Remastered file without its names section: an empty one first (no names: the header's stay), so the tag is where a reader looks.
    return join([bytes.subarray(0, l.mapEnd), rawSection(new Uint8Array(0x300)), ours, bytes.subarray(l.mapEnd)]);
  }
  const parts: Uint8Array[] = [bytes.subarray(0, l.runStart)];
  for (const t of l.tagged) if (t.kind !== SCMJ) parts.push(bytes.subarray(t.start, t.end));
  parts.push(ours, bytes.subarray(l.runEnd));
  return join(parts);
}

export async function parseReplay(bytes: Uint8Array, unzip: Inflate = inflate): Promise<Replay> {
  const format = detectFormat(bytes);
  if (!format) throw new ReplayError(msg("This is not a StarCraft replay."));
  const r = new Reader(bytes);

  const id = await section(r, 4, format, unzip);
  if (format === "1.21") r.u32();
  const { header, slots } = readHeader(await section(r, 0x279, format, unzip), format);
  const { commands, unknown } = readCommands(await sized(r, format, unzip));
  const chk = await sized(r, format, unzip);
  void id;

  // Remastered: the full-length player names, then tagged sections; a legacy file may have
  // tagged sections straight after the map. A damaged or unfamiliar tail costs only what it
  // would have added.
  let mod: ModTag | null = null;
  let run = format === "legacy";
  if (!run && !tagHere(r)) {
    try {
      const names = await section(r, 0x300, format, unzip);
      slots.forEach((s, i) => {
        if (s.type === 0 || (i + 1) * 96 > names.length) return;
        const name = cString(names.subarray(i * 96, (i + 1) * 96));
        if (name) s.name = name;
      });
      run = true;
    } catch { /* optional sections */ }
  }
  for (const t of run ? taggedRun(r) : []) {
    if (t.kind === tag("CCLR") && format !== "legacy") {
      try {
        const colors = await section(new Reader(bytes.subarray(t.body, t.end)), TAGGED[t.kind], format, unzip);
        const dv = new DataView(colors.buffer, colors.byteOffset, colors.byteLength);
        slots.forEach((s, i) => {
          if ((i + 1) * 16 > colors.length) return;
          const c = [0, 4, 8].map((o) => Math.round(Math.min(1, Math.max(0, dv.getFloat32(i * 16 + o, true))) * 255));
          if (dv.getFloat32(i * 16 + 12, true) > 0) s.color = hex((c[0] << 16) | (c[1] << 8) | c[2]);
        });
      } catch { /* optional sections */ }
    } else if (t.kind === SCMJ && !mod) {
      mod = await readModBody(bytes.subarray(t.body, t.end), format, unzip);
    }
  }

  const players = slots.filter((s) => s.name !== "" && s.type !== 0);
  // A two-player melee game often has both on team 0; they are opponents.
  if ((header.gameType === 2 || header.gameType === 4) && players.length === 2 && players[0].team === players[1].team) {
    players[0].team = 1;
    players[1].team = 2;
  }
  if (header.gameType === 3) players.forEach((p, i) => { p.team = i + 1; });
  return { format, header, players, commands, unknownCommands: unknown, chk, mod };
}
