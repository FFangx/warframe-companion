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

Cache freshness and source-data age are independent. Cache freshness answers whether
the local file was loaded/refreshed inside the 24-hour cache TTL. Source age compares
the WFCD source modification time with the query clock: after 30 days it emits an
explicit aged-source warning, and after 90 days `drops.search` returns
`SOURCE_TOO_OLD` even if the local cache was loaded recently. A stale cache is usable
only while its source version remains inside that hard gate.

Refresh probes metadata from jsDelivr and GitHub Raw for the same MIT-licensed WFCD
repository. The snapshot records both hashes/timestamps, divergence, the selected
endpoint and the comparison time. If one metadata endpoint is unavailable, the
result explains that only one endpoint was verified; if versions differ, the newer
source modification time wins and the divergence remains visible as a warning.

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
slice. The first bilingual alias layer is maintained as original project content in
`packages/warframe-data-service/src/drop-aliases.ts` and therefore uses this
repository's MIT license. Alias results expose that attribution. Broader Chinese
coverage still requires a separately licensed source or additional project-maintained
entries.

## Reconsider SQLite only when measured

Reopen this decision if at least one real workload needs transactional user-owned
state, multi-table joins/aggregations, safe delta updates across several datasets,
or the snapshot/index fails an agreed startup-memory or query-latency budget. The
typed service contract must stay stable when the storage backend changes.
