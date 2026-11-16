/** The Zuri Home mark: a house with a check inside it (a property that has been checked). Decorative, so hidden from screen readers. */
export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs><linearGradient id="zg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2e8468" /><stop offset="1" stopColor="#174d3d" /></linearGradient></defs>
      <rect width="64" height="64" rx="15" fill="url(#zg)" />
      <path d="M13 32 32 16.5 51 32" fill="none" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.5 29v18.5h25V29" fill="none" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25.5 38.5l5 5 9-10.5" fill="none" stroke="#f0b95a" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
