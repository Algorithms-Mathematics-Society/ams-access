"use client";

/**
 * Sign-in, by handle.
 *
 * A candidate receives a handle such as `ayush.s-kqmwd@access` from their
 * organizer on a printed slip or by email. Everything here serves that: `@access` is rendered as a fixed suffix
 * inside the field rather than typed, so there is nothing to misspell and
 * nothing to forget; pasting the whole string still works because the
 * formatter drops everything from the `@` on; and the password is shown by
 * default, preserving the existing credential-entry behavior and making
 * typing errors easier to spot before submitting.
 */

import type { FormEvent } from "react";
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
  error,
  diagnostic,
  onSubmit,
}: {
  loginId: string;
  setLoginId: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  loading: boolean;
  error: string | null;
  /** `host · CODE` for a connection that produced no HTTP response. Rendered
   * quietly under the error: it is for whoever is helping, not the candidate. */
  diagnostic?: string | null;
  onSubmit: (event: FormEvent) => void;
}) {
  const errorDescription = error ? "login-error" : undefined;

  return (
    <form onSubmit={onSubmit} data-login-form noValidate>
      <VStack gap={5}>
        <Field label="Your handle" inputID="login-id" width="100%">
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
              placeholder="ayush.s-kqmwd"
              autoComplete="username"
              // Preserve lowercase handles on mobile keyboards.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={64}
              aria-describedby={errorDescription}
              autoFocus
              required
            />
            <Text
              type="supporting"
              color="secondary"
              aria-hidden="true"
              style={{
                alignSelf: "center",
                paddingInlineEnd: "var(--spacing-3)",
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              {HANDLE_SUFFIX}
            </Text>
          </HStack>
        </Field>

        <Field label="Password" inputID="login-password" width="100%">
          <HStack
            className={styles.fieldControl}
            align="center"
            gap={0}
            style={{ minHeight: "calc(var(--spacing-10) + var(--spacing-1))" }}
          >
            <input
              id="login-password"
              name="login-password"
              // Preserve the visible-password behavior so typos are easy to correct.
              type="text"
              className={styles.fieldInput}
              value={password}
              onChange={(event) => setPassword(formatPassword(event.target.value))}
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={14}
              aria-describedby={errorDescription}
              required
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
          label={loading ? "Signing in…" : "Sign in"}
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={loading}
          isLoading={loading}
          style={{ minHeight: "calc(var(--spacing-10) + var(--spacing-1))" }}
        />
      </VStack>
    </form>
  );
}
