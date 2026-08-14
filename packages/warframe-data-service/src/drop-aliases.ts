/**
 * Small, project-maintained alias set. This file is original project content and
 * is distributed under the repository MIT license; it is not copied from a
 * third-party localization dump.
 */
export const DROP_ALIAS_SOURCE = 'warframe-companion.project-aliases' as const;
export const DROP_ALIAS_LICENSE = 'MIT' as const;

export interface DropAliasEntry {
  canonicalItem: string;
  zhHans: readonly string[];
  en: readonly string[];
}

export const DROP_ALIAS_ENTRIES: readonly DropAliasEntry[] = [
  { canonicalItem: 'Neurodes', zhHans: ['神经元'], en: ['Neurode'] },
  { canonicalItem: 'Orokin Cell', zhHans: ['奥罗金电池'], en: ['Orokin Cells'] },
  { canonicalItem: 'Argon Crystal', zhHans: ['氩结晶'], en: ['Argon', 'Argon Crystals'] },
  { canonicalItem: 'Control Module', zhHans: ['控制模块'], en: ['Control Modules'] },
  { canonicalItem: 'Neural Sensors', zhHans: ['神经传感器'], en: ['Neural Sensor'] },
  { canonicalItem: 'Morphics', zhHans: ['非晶态合金'], en: ['Morphics Alloy'] },
  { canonicalItem: 'Gallium', zhHans: ['镓'], en: ['Gallium Resource'] },
  { canonicalItem: 'Tellurium', zhHans: ['碲'], en: ['Tellurium Resource'] },
  { canonicalItem: 'Forma Blueprint', zhHans: ['Forma 蓝图', '福马蓝图'], en: ['Forma BP'] },
] as const;
