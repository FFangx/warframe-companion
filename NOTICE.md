# Notices

Warframe and related names, game data, images and trademarks are the property of Digital Extremes Ltd. This project is an independent community tool and is not affiliated with or endorsed by Digital Extremes.

Third-party data sources and assets are not covered by this repository's MIT license. Their own licenses and terms continue to apply. Source-specific attribution will be recorded when an adapter or asset is added.

The read-only market query adapter uses public item, order and statistics data provided by Warframe.Market. Warframe.Market is an independent community service; its API and data remain subject to its own terms and policies.

The read-only local drop-data adapter uses the WFCD `warframe-drop-data` dataset,
which is distributed under the MIT License and is derived from Digital Extremes'
official drop tables. The adapter downloads and caches a validated snapshot at
runtime; the dataset itself is not included in this repository.

The bilingual drop aliases in `packages/warframe-data-service/src/drop-aliases.ts`
are original, project-maintained metadata distributed under this repository's MIT
License. They are not copied from the unlicensed localization export previously
considered for ingestion.
