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

Text in replays from before Remastered has no fixed encoding. It is read as UTF-8, else
as Korean (CP949) when it reads as Korean, else as Western (Windows-1252), which is right
for the replays people actually have. `cString` is that rule on its own.

`detectFormat(bytes)` says whether bytes are a replay without reading them, and
`readCommands` reads a command section by itself.

A frame is `FRAME_MS` (42) milliseconds at Fastest.

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

## Credits

The layout follows [screp](https://github.com/icza/screp) (Apache-2.0), the reference
replay parser, which in turn follows BWHF and bwreplib. Older replays are unpacked with
[mopaq](https://github.com/jeany55/mopaq)'s PKWARE decoder.

## Licence

MIT
