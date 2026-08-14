# Local Warframe data layer decision

Status: accepted for the first public drop-data slice (2026-08-14).

## Decision

Do not introduce SQLite yet. Put Warframe domain queries behind typed service
interfaces and use a validated, versioned JSON snapshot plus an in-memory index for
the first `drops.search` slice.

The application downloads the public WFCD drop snapshot on demand, validates every
row, removes source markup, compiles an item-to-drop index, and writes the snapshot
atomically under Electron `userData/public-data`. A fresh snapshot avoids network
access. If refresh fails, a previously validated snapshot may be returned as stale;
if no snapshot exists, the source is reported unavailable. No generated game data or
personal account data is committed to this repository.

The live source currently contains rows whose chance is `NaN` or `null`. Structurally
invalid rows still reject a refresh; rows with an otherwise valid identity but no
numeric chance are explicitly counted, excluded, persisted in snapshot metadata and
reported as a result warning rather than silently treated as zero.

## Evidence for the decision

- The audited source had 44,016 rows and 4,164 distinct item keys.
- A direct item-to-drop JSON index was about 2.7 MB uncompressed and 208 KB gzip.
- The first workload is exact/normalized item resolution followed by one keyed read;
  it has no relational writes, joins, transactions, or ad-hoc analytics.
- SQLite would add Electron native packaging, migrations, corruption recovery and
  update transaction concerns without improving the measured query path.
- Default SQLite FTS tokenization does not replace the project's explicit bilingual
  alias and normalization requirements.

## Data and licensing boundary

The first adapter uses WFCD `warframe-drop-data`, which declares MIT licensing and is
derived from Digital Extremes' official drop tables. Attribution remains in
`NOTICE.md`. The enhanced public-export repository inspected for Chinese names did
not expose a repository license, so its data is not bundled or ingested by this
slice. Chinese aliases require a separately licensed source or a maintained project
alias layer.

## Reconsider SQLite only when measured

Reopen this decision if at least one real workload needs transactional user-owned
state, multi-table joins/aggregations, safe delta updates across several datasets,
or the snapshot/index fails an agreed startup-memory or query-latency budget. The
typed service contract must stay stable when the storage backend changes.
