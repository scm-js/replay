# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
