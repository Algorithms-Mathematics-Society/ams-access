"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { AccessMark, AccessWordmark } from "./AccessLogo";
import styles from "./StartupAnimation.module.css";

// A new app window/document gets its own intro; returning to Welcome does not.
let hasPlayed = false;

export function StartupAnimation({ children }: { children: ReactNode }) {
  const [playing, setPlaying] = useState(() => !hasPlayed);
  const [hydrated, setHydrated] = useState(false);
  const overlay = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);

  const finish = useCallback(() => {
    restoreFocus.current = Boolean(overlay.current?.contains(document.activeElement));
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) {
      if (restoreFocus.current) {
        content.current?.querySelector<HTMLElement>("[data-startup-focus]")?.focus();
        restoreFocus.current = false;
      }
      return;
    }
    hasPlayed = true;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      finish();
      return;
    }
    setHydrated(true);
    // animationend can be missed during hydration or with a hidden WebView.
    const timeout = window.setTimeout(finish, 2100);
    const onMotionChange = () => {
      if (reducedMotion.matches) finish();
    };
    reducedMotion.addEventListener("change", onMotionChange);
    return () => {
      window.clearTimeout(timeout);
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, [playing, finish]);

  return (
    <>
      <VStack ref={content} className={styles.content} inert={hydrated && playing}>
        {children}
      </VStack>
      {playing && (
        <VStack
          as="section"
          ref={overlay}
          aria-label="Access startup"
          className={styles.overlay}
          align="center"
          justify="center"
          gap={0}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) finish();
          }}
        >
          <VStack aria-hidden="true" className={styles.artwork} align="center" gap={0}>
            <AccessMark className={styles.mark} />
            <AccessWordmark className={styles.wordmark} />
            <Text type="supporting" className={styles.tagline}>
              Let the work speak.
            </Text>
          </VStack>
          <Text role="status" className={styles.status}>
            Starting Access
          </Text>
          <Button
            label="Skip intro"
            variant="ghost"
            size="sm"
            className={styles.skip}
            onClick={finish}
          />
        </VStack>
      )}
    </>
  );
}
