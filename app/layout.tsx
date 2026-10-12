import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PageSpeed Advisor',
  description: 'Template-based PageSpeed advice for Deccan Herald and Prajavani',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
