import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pipelex Starter",
  description: "Minimal Next.js app calling Pipelex via the mthds SDK.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
