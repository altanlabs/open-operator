import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Browser API",
  description: "A simple API for AI-powered web browsing automation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
