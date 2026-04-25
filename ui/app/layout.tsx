import { Metadata } from "next";
import "./globals.css";
import { Nav } from "./components/Nav";

export const metadata: Metadata = {
  title: "BazaarBATNA — AI Negotiation Agent Platform",
  description:
    "Play against MolBhav, a fine-tuned Llama 3.2 negotiation agent that reads seller tells and captures 97% of bargaining surplus. OpenEnv-compliant environment with Bayesian steering and DPO self-improvement.",
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
      className="h-full antialiased dark"
    >
      <body className="font-sans min-h-full flex flex-col bg-background text-foreground">
        <Nav />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
