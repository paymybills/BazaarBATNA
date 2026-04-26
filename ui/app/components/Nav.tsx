"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { apiGet } from "../lib/api";

const links = [
  { href: "/", label: "Home" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/sell", label: "Play" },
  { href: "/spectate", label: "Spectate" },
  { href: "/arena", label: "Arena" },
  { href: "/replay", label: "Replay" },
];

function scrollToAnchor(hash: string) {
  if (typeof window === "undefined") return;
  const el = document.getElementById(hash.replace(/^#/, ""));
  if (!el) return;
  // Lenis is wired in app-shell; falls back to native smooth-scroll if not.
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // Update URL without route navigation so user can share the deep link.
  if (window.location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);

  function handleNavClick(href: string, e: React.MouseEvent) {
    // Anchor links: route to landing if not there, else just scroll
    if (href.startsWith("/#")) {
      const hash = href.replace(/^\//, "");
      if (pathname === "/") {
        e.preventDefault();
        scrollToAnchor(hash);
      } else {
        // On a different route, navigate to landing with the hash, scroll
        // happens after page mount via the hash listener below.
        e.preventDefault();
        router.push(href);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiGet<{ status?: string }>("/health")
      .then(() => !cancelled && setHealthy(true))
      .catch(() => !cancelled && setHealthy(false));
    return () => { cancelled = true; };
  }, []);

  const dotColor = healthy === null ? "bg-foreground/30" : healthy ? "bg-good" : "bg-bad";
  const dotPulse = healthy ? "pulse-dot" : "";

  return (
    <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="max-w-7xl mx-auto px-6 flex items-center h-14 gap-10">
        <Link
          href="/"
          className="font-mono text-[13px] tracking-tight shrink-0 flex items-center gap-2"
        >
          <span className="text-foreground font-semibold">bazaarbatna</span>
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${dotPulse}`} aria-hidden />
        </Link>

        <div className="hidden md:flex gap-7 flex-1 items-center">
          {links.map((link) => {
            const active = pathname === link.href ||
              (link.href !== "/" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`text-[12px] font-medium tracking-wide transition-colors ${
                  active ? "text-foreground" : "text-fg3 hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <a
          href="https://github.com/paymybills/BazaarBATNA"
          target="_blank"
          rel="noreferrer"
          className="hidden md:inline-flex text-[11px] font-mono tracking-wide text-fg3 hover:text-foreground transition-colors"
        >
          github →
        </a>

        <button
          className="md:hidden ml-auto p-2 text-foreground/70"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-xl px-6 py-5 space-y-4">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block text-sm tracking-wide ${
                  active ? "text-foreground" : "text-fg3"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
