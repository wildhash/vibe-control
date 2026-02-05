import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibeControl | Generative UI IDE",
  description: "AI-powered IDE with generative UI - The UI Strikes Back",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
