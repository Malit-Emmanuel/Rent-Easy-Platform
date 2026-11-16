import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import Shell from '@/components/Header';
import { I18nProvider } from '@/components/I18n';
import { normaliseLang } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Zuri Home', robots: { index: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#123d32' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = normaliseLang((await cookies()).get('lang')?.value);
  return (
    <html lang={lang}>
      <body><I18nProvider lang={lang}><Shell>{children}</Shell></I18nProvider></body>
    </html>
  );
}
