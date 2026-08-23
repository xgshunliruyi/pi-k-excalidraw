# Changelog

All notable changes to this project are documented here.

## [Unreleased] - local fixes

- **Save format**: `save_diagram` now enriches elements to the full
  excalidraw.com schema before writing — text width/height are measured
  against a bundled Excalifont latin TTF (`fontMetrics.ts`, zero deps,
  CJK at 1em per glyph), `fontFamily`/`seed`/`version`/… defaults are filled,
  and the `label` shorthand is converted to a centered standalone text
  element. Saved files open directly in excalidraw.com; no post-processing
  script needed.
- **Screenshot persistence**: `screenshot_diagram` also writes the PNG to
  `.pi/excalidraw-diagrams/.screenshots/<checkpoint>.png` and reports the
  path, so non-vision models (and the user) can inspect it without relying
  on inline attachments.
- **Non-vision models**: draw/mermaid/review instructions now branch on
  image support — models that cannot receive images verify layout
  programmatically instead of looping on invisible screenshots.
- **Review loop**: `agent_end` review messages are queued with
  `deliverAs: "followUp"`, fixing the
  `Extension "<runtime>" error: Agent is already processing` crash.

## [0.2.0] - 2026-05-03

Adds a full diagramming workflow on top of the v0.1.0 preview tool. Four new
tools land alongside `draw_diagram`: `draw_mermaid_diagram` converts Mermaid
flowcharts/sequences/class/ER sources into native Excalidraw elements in the
webview ([#1](https://github.com/kostyay/pi-k-excalidraw/pull/1)),
`screenshot_diagram` exports the current canvas as a PNG so the model can
visually self-correct overlaps and off-camera elements, and
`load_diagram` / `list_diagrams` browse and restore diagrams persisted under
`.pi/excalidraw-diagrams/<slug>.excalidraw`. The `/excalidraw` command now
arms a post-turn review loop that prompts the user to send the screenshot
back to the LLM with optional comments for another refinement pass.

Window lifecycle is consolidated behind a single `startPreviewWindow()`
helper that clears the cached promise on failure so the next call retries
instead of being permanently wedged
([#3](https://github.com/kostyay/pi-k-excalidraw/pull/3)). `glimpseui` is
now a declared runtime dependency in `package.json` rather than relying on
fallback path resolution from `process.execPath`, with a friendlier error
pointing at the install URL when it can't be resolved.

Code quality gates added: ESLint with a pragmatic TypeScript config, a
testable `diagrams.ts` module with full unit tests for the slug/path/parse
helpers, and CI that runs lint before typecheck. Documentation gains an
architecture diagram ([#2](https://github.com/kostyay/pi-k-excalidraw/pull/2))
and an embedded GIF walkthrough of `/excalidraw` driving the live preview.

## [0.1.0] - 2026-05-03

### Added

- Initial release of `pi-k-excalidraw`.
- `draw_diagram` tool — render an array of Excalidraw elements in a live
  glimpse preview window with streaming partial-JSON support and per-element
  throttling.
- `save_diagram` tool — persist the most recently rendered diagram to a
  `.excalidraw` file.
- `/excalidraw <description>` command — kicks off a drawing turn and injects
  the Excalidraw element-format cheat sheet into the system prompt for the
  rest of the session.
- Clipboard export helpers (PNG/SVG) including macOS-native PNG clipboard
  support via `osascript`.
- Webview preview powered by `@excalidraw/excalidraw` loaded from `esm.sh`,
  with checkpoint-based diagram persistence so successive draws can extend
  the previous canvas instead of replacing it.
- Standalone prompt files in `extensions/pi-k-excalidraw/prompts/` so the
  element-format cheat sheet and drawing instructions can be edited without
  rebuilding.
