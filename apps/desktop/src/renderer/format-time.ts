export function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium', timeStyle: 'medium', hour12: false,
  }).format(new Date(value));
}
