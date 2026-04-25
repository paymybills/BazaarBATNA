"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const links = [
  { href: "/", label: "Home" },
  { href: "/sell", label: "Try It", accent: true },
  { href: "/negotiate", label: "Buy" },
  { href: "/spectate", label: "Spectate" },
  { href: "/replay", label: "Replay" },
  { href: "/arena", label: "Arena" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Nav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-8">
        <Link href="/" className="font-bold text-lg tracking-tight shrink-0">
          Bazaar<span className="text-accent">BATNA</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex gap-1 flex-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                link.accent && pathname !== link.href
                  ? "bg-accent/10 text-accent hover:bg-accent/20"
                  : pathname === link.href
                  ? "bg-accent/15 text-accent"
                  : "text-foreground/60 hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden ml-auto p-2 hover:bg-surface-2 rounded-lg"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-surface px-4 py-3 space-y-1 animate-fade-in">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "bg-accent/15 text-accent"
                  : "text-foreground/60 hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
