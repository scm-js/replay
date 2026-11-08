# @scm-js/replay

Read StarCraft: Brood War replays (`.rep`) in JavaScript and TypeScript, from 1.16 to
Remastered: the game's header, the players, every command each player gave, and the map
the game was played on.

[![npm](https://img.shields.io/npm/v/@scm-js/replay.svg)](https://www.npmjs.com/package/@scm-js/replay)
[![CI](https://github.com/scm-js/replay/actions/workflows/ci.yml/badge.svg)](https://github.com/scm-js/replay/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@scm-js/replay.svg)](./LICENSE)

The same build runs in Node 18+ and the browser, as ESM or CommonJS, with TypeScript
declarations. It is the reader behind [scmJS](https://scmjs.dev/editor/)'s replay viewer
(the Aftermath plugin) and the `scmjs` command line.

## Install

```sh
npm install @scm-js/replay
```

## Use

```ts
import { readFile } from "node:fs/promises";
import { FRAME_MS, parseReplay, ReplayError } from "@scm-js/replay";

const replay = await parseReplay(new Uint8Array(await readFile("game.rep")));

console.log(replay.header.mapName, `${Math.round((replay.header.frames * FRAME_MS) / 60000)} min`);
for (const p of replay.players) console.log(p.name, ["Zerg", "Terran", "Protoss"][p.race], p.color);

const builds = replay.commands.filter((c) => c.kind === "build");
```

A file that is not a replay, or is damaged, makes `parseReplay` reject with a
`ReplayError`. Its message is one of `REPLAY_ERRORS`, in English, so an app can show it
translated.

## What you get

| | |
| --- | --- |
| `format` | `"legacy"` (1.16 and before), `"1.18"` (Remastered 1.18 to 1.20) or `"1.21"` (Remastered 1.21 on) |
| `header` | Engine, length in frames, start time, game title, map name and size, speed, game type, host |
| `players` | Name (Remastered's full-length names where present), race, team, slot, the id commands carry, and colour as `#rrggbb` (Remastered's own colours where present) |
| `commands` | Every command with its frame and player, by kind (`select`, `rightClick`, `targeted`, `build`, `train`, `morph`, `upgrade`, `tech`, `hotkey`, `chat`, `leave`, …) and the game's own type byte, with positions, units, orders and selected unit tags where the command has them |
| `unknownCommands` | Commands whose type the reader does not know (the rest of their frame is skipped) |
| `chk` | The map as a bare `scenario.chk` |
| `mod` | The mod the game was played with, from an `SCMJ` section (see [Mod identity](#mod-identity)), or `null` |

Text in replays from before Remastered has no fixed encoding. It is read as UTF-8, else
as Korean (CP949) when it reads as Korean, else as Western (Windows-1252), which is right
for the replays people actually have. `cString` is that rule on its own.

`detectFormat(bytes)` says whether bytes are a replay without reading them, and
`readCommands(section, format)` reads a command section by itself.

A 1.16.1 replay of a mod may carry the mod's own command types: a plugin can send commands
under ids the game itself does not use, such as 0x60 to 0x65, which only Remastered 1.21
gives a meaning. The reader counts them in `unknownCommands` and leaves out the rest of
their frame, so the analysis of a mod's replay sees only the game's own commands.

A frame is `FRAME_MS` (42) milliseconds at Fastest.

## Mod identity

A replay records commands, not the files the game read, so a replay of a modded game
plays back wrong (or not at all) with other files. scmJS's tools add a section that says
which mod a game was played with, so a viewer can find that mod, or refuse to play the
replay with a different version of it.

```ts
import { appendModTag, readModTag, stripModTag } from "@scm-js/replay";

const tagged = await appendModTag(bytes, {
  v: 1,
  dataSet: { hash: "1f2e3d4c5b6a7980", name: "My Mod", url: "https://example.org/my-mod" },
  plugins: [{ name: "plugin.qdp", sha256: "…64 hex digits…" }],
  firegraft: null,
  noplugins: false,
  engine: null,
  madeBy: "my-tool 1.0.0",
});
(await parseReplay(tagged)).mod;   // the same object
await readModTag(tagged);          // the same, without reading the rest
await stripModTag(tagged);         // the file as it was
```

`appendModTag` replaces a section the file already has, and rejects when the file is not a
replay (`ReplayError`), the object lacks a field or has one of the wrong type
(`TypeError`), or its JSON is longer than `MOD_TAG_MAX` (4,096) bytes (`RangeError`).
`isModTag` is the shape check on its own. A damaged section reads as `null`, never as an
error: the rest of the replay reads as before.

### The section

A tagged section, as Remastered writes its own (`LMTS`, `CCLR`, …): the four bytes `SCMJ`,
a 32-bit little-endian length of what follows, then two framed sections, as the commands
and the map are framed: a four-byte section holding the payload's size, then the payload.
`appendModTag` writes each as one chunk stored as is (a chunk as long as its data is not
packed), so it needs no compressor; a reader takes a packed chunk too. The checksums are the
game's (CRC-32 from `0xFFFFFFFF`, without the final inversion); this reader does not check
them.

Where it goes:

- Remastered (1.18 and later): among the tagged sections after the player names, written
  last.
- Legacy (1.16 and before): straight after the map section, which is where a 1.16 file
  ends. 1.16.1's own replay loader reads the four sections and nothing after them, so the
  game plays a tagged replay exactly as the same file without the section.

Readers before 1.1.0 step over it in Remastered files, as over any section they do not
know, and do not read past the map in legacy ones.

### The payload

UTF-8 JSON, one object:

| Field | |
| --- | --- |
| `v` | The format's version, `1` |
| `dataSet` | `{ hash, name, url }`: the files the mod changes. `hash` is 16 lowercase hex digits: the first 16 of the SHA-256 over the changed files' `name<TAB>sha256` lines, sorted, joined by newlines. `url` is the makers' page, or `null` |
| `plugins` | `[{ name, sha256 }]`: the code that ran, in the order it was loaded; `[]` for none |
| `firegraft` | `{ name, sha256 }` of the FireGraft patch applied, or `null` |
| `noplugins` | `true` when the game was played without the mod's plugins |
| `engine` | `{ lifter, build }`: the engine that played the game, or `null` |
| `madeBy` | The program that wrote the section, such as `scm-sim 0.16.0` |

Every `sha256` is 64 lowercase hex digits. Fields a reader does not know are kept in what it
returns, so a later version can add some.

## Writing replays for tests

`@scm-js/replay/write` builds a replay file in any of the three formats from a header, a
command stream and a map, so code that reads replays can be tested without shipping anyone's
games. It runs in Node only.

```ts
import { chk, cmds, le16, writeReplay } from "@scm-js/replay/write";

const bytes = writeReplay({
  format: "1.21",
  frames: 120,
  players: [{ index: 0, id: 0, race: 1, name: "Alpha" }, { index: 1, id: 1, race: 0, name: "Beta" }],
  commands: cmds([[50, 0, 0x1f, ...le16(7)]]),   // frame 50: player 0 trains an SCV
  chk: chk(64, 64),
});
```

`mod` adds an `SCMJ` section, packed the format's way.

## Credits

The layout follows [screp](https://github.com/icza/screp) (Apache-2.0), the reference
replay parser, which in turn follows BWHF and bwreplib. Older replays are unpacked with
[mopaq](https://github.com/jeany55/mopaq)'s PKWARE decoder.

## Licence

MIT
