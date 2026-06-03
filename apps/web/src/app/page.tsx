"use client";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useState } from "react";

export default function WelcomePage() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Slight delay so the fade-in plays after mount
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="welcome-root">
      {/* Full-bleed background */}
      <Image
        src="/AMS_ACCESS_WELCOME_PAGE.png"
        alt=""
        fill
        priority
        quality={95}
        className="welcome-bg"
        sizes="100vw"
      />

      {/* Gradient overlay — darkens bottom so button is legible */}
      <div className="welcome-overlay" />

      {/* Content */}
      <div className={`welcome-content${visible ? " welcome-content--visible" : ""}`}>
        <button type="button" className="welcome-cta" onClick={() => router.push("/login")}>
          Get Started
        </button>
      </div>
    </div>
  );
}
