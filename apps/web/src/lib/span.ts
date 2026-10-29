/** "2d 3h", "5h 10m", "40m" */
export function span(minutes: number): string {
  const m = Math.abs(Math.round(minutes)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}
