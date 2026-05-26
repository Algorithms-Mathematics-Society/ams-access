"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

type LegalSection = {
  title: string;
  body: ReactNode;
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  effectiveDate: string;
  sections: LegalSection[];
};

const pageStyle: CSSProperties = {
  width: "min(960px, calc(100% - 40px))",
  margin: "0 auto",
  padding: "56px 0 72px",
};

function getLegalThemeColors(theme: "dark" | "light") {
  const isLight = theme === "light";
  return {
    shellBg: isLight
      ? "radial-gradient(circle at 50% -10%, rgba(124,58,237,0.10), transparent 34%), #f7f4ee"
      : "radial-gradient(circle at 50% -10%, rgba(168,85,247,0.13), transparent 34%), #02040a",
    panelBg: isLight
      ? "linear-gradient(135deg, rgba(255,255,255,0.96), rgba(250,248,245,0.98))"
      : "linear-gradient(135deg, rgba(8,11,17,0.96), rgba(3,6,12,0.98))",
    border: isLight ? "rgba(124,58,237,0.12)" : "rgba(255,255,255,0.08)",
    divider: isLight ? "rgba(48,42,59,0.08)" : "rgba(255,255,255,0.06)",
    text: isLight ? "#302a3b" : "#f8fafc",
    muted: isLight ? "rgba(48,42,59,0.66)" : "rgba(226,232,240,0.68)",
    faint: isLight ? "rgba(48,42,59,0.48)" : "rgba(226,232,240,0.48)",
    accent: isLight ? "#6d28d9" : "#a78bfa",
    link: isLight ? "#6d28d9" : "#c4b5fd",
    shadow: isLight ? "0 24px 70px rgba(80,70,55,0.12)" : "0 24px 70px rgba(0,0,0,0.36)",
  };
}

export function LegalPage({ eyebrow, title, description, effectiveDate, sections }: LegalPageProps) {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [backHref, setBackHref] = useState("/");
  const c = getLegalThemeColors(theme);
  const mutedStyle: CSSProperties = {
    color: c.muted,
    lineHeight: 1.7,
  };

  useEffect(() => {
    const saved = localStorage.getItem("ams_theme");
    if (saved === "dark" || saved === "light") {
      setTheme(saved);
    } else {
      localStorage.setItem("ams_theme", "light");
    }
    setBackHref(localStorage.getItem("ams_user_email") ? "/home" : "/");
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("ams_theme", next);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        overflowY: "auto",
        background: c.shellBg,
        color: c.text,
        fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
        transition: "background 260ms var(--ease-cinematic), color 260ms var(--ease-cinematic)",
      }}
    >
      <div style={pageStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <Link
            href={backHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              color: c.link,
              fontSize: "13px",
              textDecoration: "none",
            }}
          >
            <span aria-hidden="true">{"<"}</span>
            Back to Access
          </Link>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "8px",
              border: `1px solid ${c.border}`,
              background: c.panelBg,
              color: c.link,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: c.shadow,
            }}
          >
            {theme === "light" ? (
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
                <path d="M14.5 10.4A5.8 5.8 0 0 1 7.6 3.5a6 6 0 1 0 6.9 6.9Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>

        <article
          style={{
            border: `1px solid ${c.border}`,
            background: c.panelBg,
            borderRadius: "8px",
            boxShadow: c.shadow,
          }}
        >
          <header
            style={{
              padding: "36px",
              borderBottom: `1px solid ${c.border}`,
            }}
          >
            <p
              style={{
                color: c.accent,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                marginBottom: "12px",
              }}
            >
              {eyebrow}
            </p>
            <h1
              style={{
                fontSize: "clamp(30px, 5vw, 48px)",
                lineHeight: 1.05,
                fontWeight: 600,
                letterSpacing: "0",
                marginBottom: "18px",
                color: c.text,
              }}
            >
              {title}
            </h1>
            <p style={{ ...mutedStyle, fontSize: "16px", maxWidth: "760px" }}>{description}</p>
            <p
              style={{
                marginTop: "22px",
                color: c.faint,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
              }}
            >
              Effective date: {effectiveDate}
            </p>
          </header>

          <div style={{ padding: "10px 36px 36px" }}>
            {sections.map((section, index) => (
              <section
                key={section.title}
                style={{
                  paddingTop: "28px",
                  marginTop: index === 0 ? 0 : "4px",
                  borderTop: index === 0 ? "none" : `1px solid ${c.divider}`,
                }}
              >
                <h2
                  style={{
                    color: c.text,
                    fontSize: "18px",
                    fontWeight: 600,
                    letterSpacing: "0",
                    marginBottom: "10px",
                  }}
                >
                  {section.title}
                </h2>
                <div className="legal-copy" style={mutedStyle}>
                  {section.body}
                </div>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p style={{ marginBottom: "12px" }}>{children}</p>;
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ paddingLeft: "20px", margin: "10px 0 14px" }}>
      {items.map((item, index) => (
        <li key={index} style={{ marginBottom: "8px" }}>
          {item}
        </li>
      ))}
    </ul>
  );
}
