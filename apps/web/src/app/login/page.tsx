"use client";

/**
 * Sign-in, by handle.
 *
 * Candidates use organizer-issued credentials rather than an email OTP.
 * The app does not require a candidate mailbox: organizers can hand out
 * printed slips or distribute the same handle and password by email.
 *
 * Credentials are contest-scoped, so a successful sign-in already says which
 * contest this is. Nothing here asks for a session code.
 */

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useRouter } from "next/navigation";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { ThemeToggle } from "@/components/ThemeToggle";
import { invoke } from "@ams/api-client";
import { describeUnreachable } from "@/lib/network-error";
import { ProctorApiError, studentLogin } from "@/lib/proctor-api";
import { BrandPane } from "./components/BrandPane";
import { SlipForm } from "./components/SlipForm";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `host · CODE` for a status-0. Shown small and quiet under the error: the
  // candidate does not need it, and the person helping them cannot work
  // without it. See `network-error.ts`.
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const homePrefetched = useRef(false);
  useEffect(() => {
    if (!loginId || homePrefetched.current) return;
    homePrefetched.current = true;
    router.prefetch("/home");
  }, [loginId, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setDiagnostic(null);
    setLoading(true);

    try {
      const result = await studentLogin(loginId, password);

      // The contest is remembered so the rest of the app never has to ask
      // which one this is. It is the server's answer, not the candidate's.
      if (result.contest) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_CONTEST, result.contest.uid);
        localStorage.setItem(STORAGE_KEYS.ACTIVE_CONTEST_TITLE, result.contest.title);
      }
      localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, result.user.display_name);

      router.push("/home");
    } catch (caught) {
      setLoading(false);
      if (!(caught instanceof ProctorApiError)) {
        setError("Something went wrong signing in. Try again, or ask an invigilator.");
        return;
      }

      if (caught.needsUpgrade) {
        // The one error where telling them exactly what to do is the whole
        // point: a version mismatch is unfixable from inside the app.
        setError(caught.message);
        return;
      }
      if (caught.status === 0) {
        // No HTTP response at all. Distinguish "wait" from "get help", and
        // name the host, so the next person to see this does not repeat the
        // investigation that produced it.
        const { message, diagnostic } = describeUnreachable({
          code: caught.code,
          apiBase: caught.detail?.api_base,
        });
        setError(message);
        setDiagnostic(diagnostic);
        // Leave a trace. Login failures previously produced nothing: no
        // console line, no violation, no proctoring event. This writes
        // straight to the local JSONL spool, which needs no session, and is
        // uploaded once one exists.
        void invoke("log_proctoring_event", {
          kind: "api_unreachable",
          detail: diagnostic,
          timestamp: Date.now(),
          payload: { api_base: caught.detail?.api_base ?? null, code: caught.code, phase: "login" },
        }).catch(() => {});
        return;
      }
      // The server's own wording. It already distinguishes "incorrect",
      // "revoked" and "too many attempts" carefully, and paraphrasing it here
      // would lose the difference at exactly the moment it matters.
      setError(caught.message);
    }
  }

  // Frame budget: 400px form + 400px guidance + 80px gutter on desktop.
  // Flex wrapping keeps the form first at narrow widths; page scrolling stays
  // available at short heights and the theme control remains in normal flow.
  return (
    <AppShell height="fill" variant="section" contentPadding={0}>
      <VStack
        data-login-page
        className={styles.page}
        gap={6}
        style={{
          width: "100%",
          maxWidth: "calc(var(--spacing-10) * 28)",
          minHeight: "100%",
          marginInline: "auto",
          padding: "clamp(var(--spacing-4), 4vw, var(--spacing-10))",
        }}
      >
        <HStack as="header" gap={4} justify="between" align="center">
          <HStack gap={3} align="center">
            <svg
              width="var(--spacing-6)"
              height="var(--spacing-6)"
              viewBox="0 0 172 162"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M2.00043 162L87.0004 2L172 162"
                stroke="var(--color-accent-base)"
                strokeWidth="6"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
            </svg>
            <Text type="large" weight="semibold">
              Access
            </Text>
          </HStack>
          <ThemeToggle />
        </HStack>

        <HStack
          gap={10}
          wrap="wrap"
          align="center"
          justify="between"
          style={{
            flex: "1 0 auto",
            columnGap: "calc(var(--spacing-10) * 2)",
            paddingBlock: "clamp(var(--spacing-6), 7vh, calc(var(--spacing-10) * 2))",
          }}
        >
          <VStack
            as="section"
            aria-labelledby="login-heading"
            data-login-form-region
            gap={6}
            style={{ flex: "1 1 calc(var(--spacing-10) * 10)", minWidth: 0 }}
          >
            <VStack
              gap={6}
              style={{
                width: "100%",
                maxWidth: "calc(var(--spacing-10) * 10)",
                marginInline: "auto",
              }}
            >
              <VStack gap={2}>
                <Heading level={1} id="login-heading">
                  Sign in
                </Heading>
                <Text color="secondary">
                  Use the handle and password from your email or printed sign-in slip.
                </Text>
              </VStack>

              <SlipForm
                loginId={loginId}
                setLoginId={setLoginId}
                password={password}
                setPassword={setPassword}
                loading={loading}
                error={error}
                diagnostic={diagnostic}
                onSubmit={handleSubmit}
              />

              <Text type="supporting">
                This exam is proctored. After signing in, you’ll set up your camera and check your
                device before entering a contest.
              </Text>
              <Divider />
              <VStack gap={3} align="start">
                {/* Credentials can be reissued by an invigilator, not recovered here. */}
                <Text type="supporting">Lost your details? An invigilator can reissue them.</Text>
                <Button
                  type="button"
                  label="Can't sign in? Get help"
                  variant="ghost"
                  onClick={() => setHelpOpen(true)}
                />
              </VStack>
            </VStack>
          </VStack>
          <BrandPane />
        </HStack>
      </VStack>

      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind="LOGIN"
        summary="I can't sign in to AMS Access."
        details={{
          source: "login",
          // The handle is not a secret — it is in their email and on the
          // invigilator's roster — and it is the one thing that lets a
          // support request be matched to a candidate. The password is never
          // included.
          attempted_login_id: loginId.trim() || undefined,
          last_error: error,
          // Which host the client actually called. If the incident is that it
          // cannot reach the server, this is the field that says why.
          last_diagnostic: diagnostic,
        }}
      />
    </AppShell>
  );
}
