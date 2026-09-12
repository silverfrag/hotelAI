"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/features/figma/AccountMenu";
import { LanguageSwitch } from "@/components/features/figma/LanguageSwitch";
import { useTheme } from "@/contexts/ThemeContext";
import { useTranslation } from "@/contexts/LanguageContext";

function ThemeSwitch() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="relative flex items-center w-12 h-6 rounded-full border transition-all duration-400 shrink-0"
      style={{
        borderColor: "var(--border-gold)",
        background: isDark
          ? "rgba(196,153,90,0.08)"
          : "rgba(140,100,50,0.12)",
      }}
    >
      {/* sun icon */}
      <span
        className="absolute left-1 text-[10px] transition-opacity duration-300"
        style={{ opacity: isDark ? 0.3 : 1, color: "var(--gold)" }}
      >
        ☀
      </span>
      {/* moon icon */}
      <span
        className="absolute right-1 text-[10px] transition-opacity duration-300"
        style={{ opacity: isDark ? 1 : 0.3, color: "var(--gold)" }}
      >
        ☽
      </span>
      {/* thumb */}
      <div
        className="absolute top-0.5 w-5 h-5 rounded-full transition-all duration-350"
        style={{
          background: "var(--gold)",
          left: isDark ? "calc(100% - 1.375rem)" : "0.125rem",
        }}
      />
    </button>
  );
}

export default function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const navLinks = [
    { label: t('nav_home'), to: "/" },
    { label: t('nav_destinations'), to: "/destinations" },
    { label: t('nav_rooms'), to: "/rooms" },
    { label: t('nav_about'), to: "/about" },
  ];

  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname.startsWith(to);

  return (
    <div
      className="figma-site min-h-screen font-sans"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <a href="#public-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80]">
        Skip to content
      </a>

      {/* ── NAV ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 md:px-10 lg:px-16 py-4 transition-all duration-500"
        style={{
          background: scrolled ? "var(--nav-bg)" : "transparent",
          backdropFilter: scrolled ? "blur(20px)" : "none",
          borderBottom: scrolled
            ? "1px solid var(--border-gold)"
            : "1px solid transparent",
        }}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ border: "1px solid var(--gold)" }}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: "var(--gold)" }}
            />
          </div>
          <span
            className="font-display text-[1.05rem]"
            style={{ letterSpacing: "0.22em", color: "var(--fg2)" }}
          >
            AURUM
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-7">
          {navLinks.map((l) => (
            <Link
              key={l.to}
              href={l.to}
              className="text-[11px] tracking-[0.13em] uppercase transition-colors duration-200 relative group"
              style={{
                color: isActive(l.to) ? "var(--gold)" : "var(--muted)",
              }}
            >
              {l.label}
              <span
                className="absolute -bottom-0.5 left-0 h-px transition-all duration-300"
                style={{
                  background: "var(--gold)",
                  width: isActive(l.to) ? "100%" : "0%",
                }}
              />
            </Link>
          ))}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3 md:gap-4">
          <LanguageSwitch />
          <ThemeSwitch />
          <AccountMenu />
          <Link
            href="/book"
            className="hidden md:block text-[10px] tracking-[0.15em] uppercase px-5 py-2 transition-all duration-300 font-medium"
            style={{
              border: "1px solid var(--gold)",
              color: "var(--gold)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--gold)";
              (e.currentTarget as HTMLElement).style.color = "var(--bg)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--gold)";
            }}
          >
            {t('nav_book_now')}
          </Link>

          {/* mobile hamburger */}
          <button
            className="md:hidden flex flex-col gap-1.5 p-1"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls="public-mobile-menu"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-5 h-px transition-all duration-300"
                style={{
                  background: "var(--gold)",
                  opacity: i === 1 && menuOpen ? 0 : 1,
                  transform:
                    menuOpen && i === 0
                      ? "translateY(5px) rotate(45deg)"
                      : menuOpen && i === 2
                      ? "translateY(-5px) rotate(-45deg)"
                      : "none",
                }}
              />
            ))}
          </button>
        </div>
      </nav>

      {/* mobile menu */}
      <div
        id="public-mobile-menu"
        inert={!menuOpen}
        aria-hidden={!menuOpen}
        className="fixed inset-0 z-40 flex flex-col items-center justify-center md:hidden transition-all duration-400"
        style={{
          background: "var(--bg)",
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
        }}
      >
        <div className="flex flex-col items-center gap-7">
          {navLinks.map((l) => (
            <Link
              key={l.to}
              href={l.to}
              className="font-display text-3xl transition-colors"
              style={{ color: isActive(l.to) ? "var(--gold)" : "var(--fg)" }}
            >
              {l.label}
            </Link>
          ))}

          <div className="flex items-center gap-4 mt-3">
            <LanguageSwitch />
            <ThemeSwitch />
          </div>

          <Link
            href="/book"
            className="mt-2 text-[11px] tracking-[0.2em] uppercase px-8 py-3 border font-medium"
            style={{ borderColor: "var(--gold)", color: "var(--gold)" }}
          >
            {t('nav_book_now')}
          </Link>
        </div>
      </div>

      {/* ── PAGE CONTENT ── */}
      <div inert={menuOpen} id="public-content" tabIndex={-1} className={/^\/(checkout)(\/|$)/.test(pathname) ? "legacy-public" : undefined}>
        {children}
      </div>

      {/* ── FOOTER ── */}
      <footer inert={menuOpen}
        className="px-5 md:px-10 lg:px-16 pt-14 pb-10"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-14">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-5">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                style={{ border: "1px solid var(--gold)" }}
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--gold)" }} />
              </div>
              <span
                className="font-display text-base"
                style={{ letterSpacing: "0.22em", color: "var(--fg2)" }}
              >
                AURUM
              </span>
            </div>
            <p className="text-[11px] leading-relaxed max-w-[190px]" style={{ color: "var(--dim)" }}>
              {t('footer_tagline')}
            </p>
            <div className="flex gap-3 mt-6">
              {["IG", "FB", "TW", "YT"].map((s) => (
                <span
                  key={s}
                  title="Social profile"
                  className="w-7 h-7 flex items-center justify-center text-[9px] tracking-wider transition-all duration-200"
                  style={{
                    border: "1px solid var(--border-gold)",
                    color: "var(--dim)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)";
                    (e.currentTarget as HTMLElement).style.color = "var(--gold)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border-gold)";
                    (e.currentTarget as HTMLElement).style.color = "var(--dim)";
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {[
            {
              title: t('nav_destinations'),
              links: [
                { label: "Đà Nẵng", href: "/destinations?q=Đà%20Nẵng" },
                { label: "Phú Quốc", href: "/destinations?q=Phú%20Quốc" },
                { label: "Vịnh Ninh Vân", href: "/destinations?q=Ninh%20Vân" },
                { label: "Côn Đảo", href: "/destinations?q=Côn%20Đảo" },
              ],
            },
            {
              title: t('hero_stat_stay'),
              links: [
                { label: t('nav_rooms'), href: "/rooms" },
                { label: t('cta_plan_btn'), href: "/book" },
                { label: t('nav_my_bookings'), href: "/bookings" },
                { label: t('nav_profile'), href: "/profile" },
              ],
            },
            {
              title: t('footer_experience'),
              links: [
                { label: t('nav_about'), href: "/about" },
                { label: t('nav_destinations'), href: "/destinations" },
                { label: t('nav_login'), href: "/login" },
                { label: t('nav_register'), href: "/register" },
              ],
            },
          ].map((col) => (
            <div key={col.title}>
              <div
                className="text-[9px] tracking-[0.25em] uppercase mb-5 font-semibold"
                style={{ color: "var(--gold)" }}
              >
                {col.title}
              </div>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[11px] transition-colors"
                      style={{ color: "var(--dim)" }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.color = "var(--muted)")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.color = "var(--dim)")
                      }
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <span className="text-[9px] tracking-wider" style={{ color: "var(--dim2)" }}>
            {t('footer_copyright')}
          </span>
          <div className="flex gap-6">
            {[t('footer_privacy'), t('footer_terms'), t('footer_contact')].map((l) => (
              <span key={l} className="text-[9px] tracking-wider transition-colors cursor-pointer" style={{ color: "var(--dim2)" }}>
                {l}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
