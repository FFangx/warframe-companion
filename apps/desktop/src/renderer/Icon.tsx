import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { TagIcon } from '@phosphor-icons/react/dist/csr/Tag';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { MapPinIcon } from '@phosphor-icons/react/dist/csr/MapPin';
import { ChatCircleDotsIcon } from '@phosphor-icons/react/dist/csr/ChatCircleDots';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';

const icons = { home: SquaresFourIcon, market: TagIcon, search: MagnifyingGlassIcon, drops: MapPinIcon, assistant: ChatCircleDotsIcon, settings: GearSixIcon, plus: PlusIcon, arrow: ArrowRightIcon, history: ClockCounterClockwiseIcon, left: CaretLeftIcon, right: CaretRightIcon, refresh: ArrowClockwiseIcon } as const;

export function Icon({ name, active = false }: { name: keyof typeof icons; active?: boolean }) {
  const Symbol = icons[name];
  return <Symbol className="ui-icon" size={20} weight={active ? 'fill' : 'regular'} color="currentColor" aria-hidden="true" focusable="false" />;
}

export function BrandMark() {
  return <svg className="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" /></svg>;
}

export function OrbitMark() {
  return <svg className="orbit-mark" viewBox="0 0 240 200" fill="none" aria-hidden="true">
    <ellipse cx="120" cy="100" rx="100" ry="37" transform="rotate(-35 120 100)" />
    <ellipse cx="120" cy="100" rx="80" ry="58" transform="rotate(40 120 100)" />
    <circle cx="120" cy="100" r="51" /><path d="m120 65 14 23 21 12-21 12-14 23-14-23-21-12 21-12Z" />
    <circle className="orbit-point" cx="197" cy="47" r="4" /><circle className="orbit-point" cx="56" cy="78" r="3" />
  </svg>;
}
