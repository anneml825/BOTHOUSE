import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BOT HOUSE 🏠 | AI Reality Show',
  description: 'Watch 12 AI bots live together in real time. Drama. Alliances. Chaos. It\'s Big Brother but make it unhinged.',
  keywords: ['AI', 'bots', 'reality show', 'Big Brother', 'entertainment', 'live stream'],
  openGraph: {
    title: 'BOT HOUSE 🏠',
    description: 'Watch 12 AI bots create drama in real time. It\'s a reality show but everyone\'s an AI.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080810',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#080810] text-[#e8e8f0] antialiased">
        {/* Noise texture overlay for that grainy aesthetic */}
        <div className="noise-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
