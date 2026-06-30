"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

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
      {/* Neutral monitor vignette — physicality without the violet glow. */}
      <div className="welcome-vignette" />

      <div className={`welcome-corner welcome-corner-tl ${shown ? "welcome-corner--in" : ""}`}>
        <span className="welcome-status-dot" />
        <span className="welcome-mono-tag">System ready</span>
      </div>
      <div className={`welcome-corner welcome-corner-tr ${shown ? "welcome-corner--in" : ""}`}>
        <span className="welcome-mono-tag welcome-mono-tag--accent">AMS Access</span>
        <ThemeToggle />
      </div>

      {/* One cohesive centered block — logo → wordmark → tagline → CTA. */}
      <div className={`welcome-center ${shown ? "welcome-center--in" : ""}`}>
        <svg className="welcome-logo-svg" viewBox="0 0 172 162" fill="none" aria-hidden="true">
          <path
            d="M2.00043 162L87.0004 2L172 162"
            stroke="var(--color-accent-base)"
            strokeWidth="6"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="welcome-wordmark-svg" src="/ACCESS_WORDMARK.svg" alt="Access" />
        <p className="welcome-byline">by AMS</p>
        <p className="welcome-tagline">Fair · Secure · Proctored</p>
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
