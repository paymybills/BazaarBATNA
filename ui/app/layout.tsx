import { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "./components/Nav";
import { SmoothScroll } from "./components/SmoothScroll";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BazaarBATNA — Negotiation Playground",
  description:
    "An OpenEnv negotiation playground. Watch agents haggle. Or step in yourself.",
  keywords: ["negotiation", "AI agent", "game theory", "NLP", "OpenEnv", "MolBhav", "BazaarBATNA"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} antialiased`}
    >
      <body className="min-h-screen flex flex-col bg-background text-foreground">
        <SmoothScroll />
        <Nav />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
