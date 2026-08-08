"use client";

/**
 * The printed-slip sign-in.
 *
 * A candidate is holding a piece of paper with two grouped codes on it and is
 * about to sit an exam. Everything here is in service of that: the fields
 * auto-hyphenate so they cannot fight the format, the login id is uppercased
 * as they type because the slip is uppercase, and the password is shown by
 * default — it is on paper in their hand, there is nobody to shoulder-surf
 * that they are not already sitting next to, and silent typos in a masked
 * field are how people lock themselves out of their own exam.
 */

import type { FormEvent } from "react";

import { formatLoginId, formatPassword } from "./slip-format";

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
        Login ID
      </label>
      <input
        id="login-id"
        name="login-id"
        className="login-input"
        value={loginId}
        onChange={(event) => setLoginId(formatLoginId(event.target.value))}
        placeholder="AMS-XXXX-XXXX"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        maxLength={13}
        autoFocus
        required
      />

      <label className="login-label" htmlFor="login-password">
        Password
      </label>
      <input
        id="login-password"
        name="login-password"
        // Not masked: it is printed on the slip in their hand, and a masked
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
