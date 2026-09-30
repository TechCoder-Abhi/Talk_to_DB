import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Talk to DB — Ask your data',
  description: 'Explore PostgreSQL, MySQL, and MongoDB with natural language.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
