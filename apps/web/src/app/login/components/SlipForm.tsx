"use client";

/**
 * Sign-in, by handle.
 *
 * A candidate has `ayush.s-kqmwd@access` in an email and is about to sit an
 * exam. Everything here serves that: `@access` is rendered as a fixed suffix
 * inside the field rather than typed, so there is nothing to misspell and
 * nothing to forget; pasting the whole string still works because the
 * formatter drops everything from the `@` on; and the password is shown by
 * default — it is in the same email, there is nobody to shoulder-surf that
 * they are not already sitting next to, and silent typos in a masked field
 * are how people lock themselves out of their own exam.
 */

import type { FormEvent } from "react";

import { formatHandle, formatPassword, HANDLE_SUFFIX } from "./slip-format";

export function SlipForm({
  loginId,
  setLoginId,
  password,
  setPassword,
  loading,
  error,
  onSubmit,
}: {
  loginId: string;
  setLoginId: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  loading: boolean;
  error: string | null;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="login-form" noValidate>
      <label className="login-label" htmlFor="login-id">
        Your handle
      </label>
      <div className="login-handle-row">
        <input
          id="login-id"
          name="login-id"
          className="login-input login-handle-input"
          value={loginId}
          onChange={(event) => setLoginId(formatHandle(event.target.value))}
          placeholder="ayush.s-kqmwd"
          autoComplete="username"
          // Lowercase: handles are stored lowercase, and a phone keyboard
          // helpfully capitalising the first letter would otherwise be a
          // failed sign-in nobody could explain.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={64}
          autoFocus
          required
        />
        {/* Shown, not typed. `aria-hidden` because the label and the value
            already say what this field is; a screen reader announcing
            "at access" after every keystroke would be noise. */}
        <span className="login-handle-suffix" aria-hidden="true">
          {HANDLE_SUFFIX}
        </span>
      </div>

      <label className="login-label" htmlFor="login-password">
        Password
      </label>
      <input
        id="login-password"
        name="login-password"
        // Not masked: it is in the email open in front of them, and a masked
        // field turns one mistyped character into "incorrect login" with no
        // way to see why.
        type="text"
        className="login-input"
        value={password}
        onChange={(event) => setPassword(formatPassword(event.target.value))}
        placeholder="XXXX-XXXX-XXXX"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        maxLength={14}
        required
      />

      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="login-submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
