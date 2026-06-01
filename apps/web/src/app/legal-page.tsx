import Link from "next/link";
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

function getLegalThemeColors() {
  return {
    shellBg: "radial-gradient(circle at 50% -10%, rgba(124,58,237,0.10), transparent 34%), #f7f4ee",
    panelBg: "linear-gradient(135deg, rgba(255,255,255,0.96), rgba(250,248,245,0.98))",
    border: "rgba(124,58,237,0.12)",
    divider: "rgba(48,42,59,0.08)",
    text: "#302a3b",
    muted: "rgba(48,42,59,0.66)",
    faint: "rgba(48,42,59,0.48)",
    accent: "#6d28d9",
    link: "#6d28d9",
    shadow: "0 24px 70px rgba(80,70,55,0.12)",
  };
}

function slugifySectionTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function LegalPage({ eyebrow, title, description, effectiveDate, sections }: LegalPageProps) {
  const c = getLegalThemeColors();
  const mutedStyle: CSSProperties = {
    color: c.muted,
    lineHeight: 1.7,
  };

  return (
    <main
      className="legal-shell"
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
            href="/"
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
            {sections.map((section, index) => {
              const sectionId = slugifySectionTitle(section.title);

              return (
                <section
                  id={sectionId}
                  key={section.title}
                  style={{
                    paddingTop: "28px",
                    marginTop: index === 0 ? 0 : "4px",
                    borderTop: index === 0 ? "none" : `1px solid ${c.divider}`,
                    scrollMarginTop: "24px",
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
              );
            })}
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
