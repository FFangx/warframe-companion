# Desktop design system

The established visual world is an operational Windows workbench for a player consulting market data and an assistant alongside the game. Preserve the accepted graphite surfaces and muted gold accents across every implemented view.

## Foundation

- Background #191b1e; navigation #141619; surfaces #23262a; separators #363a3f.
- Text #eeeef0; secondary #a3a8ae; action emphasis #d5bb83.
- Positive #98c7ac; caution #e2c18a; failure #f1a6a0. Pair color with words.
- Microsoft YaHei UI / Segoe UI system typography. Headings 18–34px, body 13–14px, metadata 11–12px. Tabular numerals for prices.
- Phosphor Regular icons, Fill for selected navigation; custom geometric brand/orbit marks.

## Composition and behavior

A collapsible 64/180px navigation rail, central workspace, and optional 390px assistant. Below 1100px, workspace and focused assistant alternate. Keep conversation and queries mounted while switching views. Do not auto-navigate on assistant results.

Market content reads from query scope to current prices, statistics, orders and source evidence. Empty orders and service failure remain distinct. Settings use a native dialog with a persistent close control, top-aligned form labels, and progressively disclosed diagnostics.

Controls use 120ms color feedback; panels use 200ms eased grid transitions; dialogs enter in 200ms and exit with a 100ms fade. A pending query has one local spinner. Respect reduced motion. No row choreography or decorative loops.

## Implementation and verification

Shared appearance and motion are in apps/desktop/src/renderer/workbench.css; workspace structure is in styles.css. See docs/DESKTOP_VISUAL.md for surface coverage and verification. All existing UI flows use this system. Future recommendation and feature pages inherit it when their actual behavior is implemented.
