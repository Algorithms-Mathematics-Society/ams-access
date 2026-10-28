"use client";

/** Credential-slip labels with existing handle and password normalization. */

import { useState, type FormEvent } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Field } from "@astryxdesign/core/Field";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { formatHandle, formatPassword, HANDLE_SUFFIX } from "./slip-format";
import styles from "../login.module.css";

export function SlipForm({
  loginId,
  setLoginId,
  password,
  setPassword,
  loading,
  cooldownSeconds = 0,
  error,
  invalidField,
  diagnostic,
  onSubmit,
}: {
  loginId: string;
  setLoginId: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  loading: boolean;
  cooldownSeconds?: number;
  error: string | null;
  invalidField?: "handle" | "password" | null;
  /** `host · CODE` for a connection that produced no HTTP response. Rendered
   * quietly under the error: it is for whoever is helping, not the candidate. */
  diagnostic?: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const errorDescription = error ? "login-error" : undefined;
  // Keep credentials private until the candidate chooses to reveal them.
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <form onSubmit={onSubmit} data-login-form noValidate>
      <VStack gap={5}>
        <Field
          label="Login ID"
          inputID="login-id"
          width="100%"
        >
          <HStack
            className={styles.fieldControl}
            align="center"
            gap={0}
            style={{ minHeight: "calc(var(--spacing-10) + var(--spacing-1))" }}
          >
            <input
              id="login-id"
              name="login-id"
              className={styles.fieldInput}
              value={loginId}
              onChange={(event) => setLoginId(formatHandle(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  event.preventDefault();
                }
              }}
              placeholder="e.g. test-student"
              autoComplete="username"
              // Preserve lowercase handles on mobile keyboards.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              // Leave room for a full handle and keep overlong IDs invalid
              // instead of truncating them into a valid 64-character ID.
              maxLength={256}
              aria-describedby={["login-id-suffix", errorDescription].filter(Boolean).join(" ")}
              aria-invalid={invalidField === "handle" || undefined}
              autoFocus
              required
            />
            <Text
              id="login-id-suffix"
              color="secondary"
              style={{
                flexShrink: 0,
                alignSelf: "stretch",
                display: "flex",
                alignItems: "center",
                paddingInline: "var(--spacing-3)",
                borderLeft: "var(--border-width) solid var(--color-border)",
                userSelect: "text",
              }}
            >
              {HANDLE_SUFFIX}
            </Text>
          </HStack>
        </Field>

        <Field
          label="Password"
          inputID="login-password"
          description="Format: XXXX-XXXX-XXXX"
          descriptionID="login-password-help"
          width="100%"
        >
          <HStack
            className={styles.fieldControl}
            align="center"
            gap={0}
            style={{ minHeight: "calc(var(--spacing-10) + var(--spacing-1))" }}
          >
            <input
              id="login-password"
              name="login-password"
              type={passwordVisible ? "text" : "password"}
              className={styles.fieldInput}
              style={passwordVisible ? { fontFamily: "var(--font-mono), monospace" } : undefined}
              value={password}
              onChange={(event) => setPassword(formatPassword(event.target.value))}
              placeholder="Enter your password"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={14}
              aria-describedby={["login-password-help", errorDescription].filter(Boolean).join(" ")}
              aria-invalid={invalidField === "password" || undefined}
              required
            />
            <Button
              type="button"
              label={passwordVisible ? "Hide" : "Show"}
              aria-label={passwordVisible ? "Hide password" : "Show password"}
              aria-controls="login-password"
              variant="ghost"
              size="sm"
              onClick={() => setPasswordVisible((visible) => !visible)}
              style={{ flexShrink: 0, marginInlineEnd: "var(--spacing-2)" }}
            />
          </HStack>
        </Field>

        {error && (
          <Banner
            id="login-error"
            status="error"
            role="alert"
            title={error}
            description={
              diagnostic ? (
                <Text type="code" color="secondary" style={{ overflowWrap: "anywhere" }}>
                  {diagnostic}
                </Text>
              ) : undefined
            }
            style={{ minWidth: 0, overflowWrap: "anywhere" }}
          />
        )}

        <Button
          type="submit"
          label={
            loading
              ? "Signing in…"
              : cooldownSeconds > 0
                ? `Try again in ${cooldownSeconds}s`
                : "Sign in"
          }
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={loading || cooldownSeconds > 0}
          isLoading={loading}
          style={{ minHeight: "calc(var(--spacing-10) + var(--spacing-1))" }}
        />
      </VStack>
    </form>
  );
}
