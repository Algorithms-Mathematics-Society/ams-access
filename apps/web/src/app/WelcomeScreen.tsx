"use client";

import { useEffect, useState } from "react";

interface WelcomeScreenProps {
  onEnter: () => void;
}

export default function WelcomeScreen({ onEnter }: WelcomeScreenProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShown(true), 60);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="welcome-root">
      <div className="welcome-glow-primary" />
      <div className="welcome-glow-secondary" />
      {/* glow-rim intentionally omitted — §2 polish */}
      <div className="welcome-overlay" />

      <div className={`welcome-corner welcome-corner-tl ${shown ? "welcome-corner--in" : ""}`}>
        <span className="welcome-status-dot" />
        <span className="welcome-mono-tag">System ready</span>
      </div>
      <div className={`welcome-corner welcome-corner-tr ${shown ? "welcome-corner--in" : ""}`}>
        <span className="welcome-mono-tag welcome-mono-tag--accent">AMS Access</span>
      </div>

      <div className={`welcome-logo ${shown ? "welcome-logo--in" : ""}`}>
        <div className="welcome-logo-glow" />
        <svg className="welcome-logo-svg" viewBox="0 0 172 162" fill="none" aria-hidden="true">
          <path
            d="M2.00043 162L87.0004 2L172 162"
            stroke="var(--color-accent-base)"
            strokeWidth="6"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          <path
            d="M32 162L87 52L142 162"
            stroke="rgb(var(--accent-rgb) / 0.25)"
            strokeWidth="4"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
        <h1 className="welcome-wordmark">AMS</h1>
        <p className="welcome-byline">Access</p>
      </div>

      <p className={`welcome-tagline ${shown ? "welcome-tagline--in" : ""}`}>
        Fair · Secure · Proctored
      </p>

      <div className={`welcome-footer ${shown ? "welcome-footer--in" : ""}`}>
        <div className="welcome-footer-rule" />
        <button
          type="button"
          className="welcome-cta"
          aria-label="Enter workspace"
          onClick={onEnter}
        >
          Enter workspace
        </button>
        <p className="welcome-session-hint">Secure exam session</p>
      </div>
    </div>
  );
}
