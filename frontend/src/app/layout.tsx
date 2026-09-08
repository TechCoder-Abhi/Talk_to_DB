import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Talk_to_DB',
  description: 'Natural language database agent for PostgreSQL, MySQL, and MongoDB',
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
