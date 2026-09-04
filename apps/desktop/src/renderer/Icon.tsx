const paths = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  market: 'm3 17 6-6 4 3 8-10M15 4h6v6M4 21h16',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM16 16l5 5',
  assistant: 'm12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2',
} as const;

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function OrbitMark() {
  return <svg className="orbit-mark" viewBox="0 0 240 200" fill="none" aria-hidden="true">
    <ellipse cx="120" cy="100" rx="100" ry="37" transform="rotate(-35 120 100)" />
    <ellipse cx="120" cy="100" rx="80" ry="58" transform="rotate(40 120 100)" />
    <circle cx="120" cy="100" r="51" /><path d="m120 65 14 23 21 12-21 12-14 23-14-23-21-12 21-12Z" />
    <circle className="orbit-point" cx="197" cy="47" r="4" /><circle className="orbit-point" cx="56" cy="78" r="3" />
  </svg>;
}
