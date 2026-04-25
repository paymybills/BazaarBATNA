"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const links = [
  { href: "/", label: "Home" },
  { href: "/sell", label: "Try It" },
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
    <nav className="border-b border-border bg-background sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 flex items-center h-16 gap-12">
        <Link href="/" className="font-black text-xl tracking-tighter uppercase shrink-0">
          Bazaar<span className="opacity-30 italic font-light">B.</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex gap-8 flex-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-[10px] font-bold uppercase tracking-[0.2em] transition-all hover:opacity-100 ${
                pathname === link.href
                  ? "text-foreground opacity-100"
                  : "text-foreground opacity-30"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden ml-auto p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-6 space-y-4 animate-fade-in">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`block text-xs font-bold uppercase tracking-widest ${
                pathname === link.href
                  ? "text-foreground"
                  : "text-foreground opacity-40"
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
