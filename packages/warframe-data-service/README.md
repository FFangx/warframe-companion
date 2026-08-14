# Warframe data service

Warframe-specific, read-only public data access behind a storage-neutral interface.

The first slice indexes the WFCD drop snapshot in memory and persists a validated,
versioned JSON snapshot atomically. It does not bundle public data, personal account
data, or a SQLite runtime. A stale validated snapshot may be used when refresh fails;
the result evidence says so explicitly.
