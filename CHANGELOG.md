# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-14

### Added
- `DataSetRace` and `ModTag.dataSet.races`: the races a mod adds to the game's own, by
  their race byte, as a tag may name them. The tag kept the field before as one it did not
  know; it is typed now.

### Changed
- `ReplayPlayer.race` is documented as it is read: 0 to 2 the game's three races, 3 to 7 its
  others, and any other value a race a mod adds.

## [1.1.1] - 2026-11-08

### Fixed
- In a 1.16.1 replay, command types 0x60 to 0x65 are a mod's own (Remastered added them
  in 1.21) and count as unknown instead of being read as Remastered's selects and clicks;
  `readCommands` takes the replay's format.

## [1.1.0] - 2026-11-08

### Added
- Mod identity: `Replay.mod`, read from an `SCMJ` section that says which mod a game was
  played with (its data set's hash, name and link, the plugins that ran, the FireGraft
  patch, the engine and the program that wrote it). `appendModTag`, `readModTag`,
  `stripModTag`, `isModTag`, `MOD_TAG_MAX` and the `ModTag` and `ModFile` types. The
  section and its JSON are described in the README.
- `writeReplay` takes a `mod` to write the section.

### Changed
- A legacy replay is read past its map section, for tagged sections that follow it.
- A tagged section where a Remastered replay keeps its player names is no longer read as
  the names.

## [1.0.1] - 2026-11-06

### Changed
- Published from GitHub Actions with a provenance statement, which links the package to
  the commit it was built from. The code is the same as 1.0.0.

## [1.0.0] - 2026-11-05

### Added
- The reader from scmJS's Aftermath plugin, as a package of its own: `parseReplay`,
  `detectFormat`, `readCommands`, `cString`, `FRAME_MS` and the types, for replays from
  1.16 to Remastered 1.21 and later.
- `REPLAY_ERRORS`, every message a `ReplayError` can carry, for apps that translate them.
- `@scm-js/replay/write`, the writer the tests use, for other code's tests.
