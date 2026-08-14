# Warframe data service

Warframe-specific, read-only public data access behind a storage-neutral interface.

The first slice indexes the WFCD drop snapshot in memory and persists a validated,
versioned JSON snapshot atomically. It does not bundle public data, personal account
data, or a SQLite runtime.

`drops.search` contract `1.1` reports cache freshness separately from upstream source
age. Source data older than 30 days is labelled aged; data older than 90 days is
rejected rather than used for a current answer. Refresh compares the jsDelivr and
GitHub Raw endpoints of the same MIT-licensed WFCD repository and records hashes,
timestamps, the selected endpoint, and any divergence. A stale validated cache may
still be used only while its source version remains inside the source-age gate.

The small bilingual alias table is maintained in this repository and distributed
under the project MIT license. Each alias resolution returns its source and license;
no unlicensed localization export is ingested.
