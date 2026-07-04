import { type Dispatch, type SetStateAction } from "react";
import { isGatingRelaxed } from "@/lib/gating";

export interface PasswordFormProps {
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  emailFocused: boolean;
  setEmailFocused: Dispatch<SetStateAction<boolean>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  passFocused: boolean;
  setPassFocused: Dispatch<SetStateAction<boolean>>;
  loading: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleDevSignIn: () => void;
}

export function PasswordForm({
  email,
  setEmail,
  emailFocused,
  setEmailFocused,
  password,
  setPassword,
  passFocused,
  setPassFocused,
  loading,
  error,
  setError,
  handleSubmit,
  handleDevSignIn,
}: PasswordFormProps) {
  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="login-field">
        <label
          htmlFor="login-email"
          className={`login-label${emailFocused ? " login-label--focused" : ""}`}
        >
          Email
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => {
            setError(null);
            setEmail(e.target.value);
          }}
          onFocus={() => setEmailFocused(true)}
          onBlur={() => setEmailFocused(false)}
          placeholder="you@institution.edu"
          autoComplete="email"
          required
          disabled={loading}
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className="login-input"
        />
      </div>

      <div className="login-field">
        <label
          htmlFor="login-password"
          className={`login-label${passFocused ? " login-label--focused" : ""}`}
        >
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => {
            setError(null);
            setPassword(e.target.value);
          }}
          onFocus={() => setPassFocused(true)}
          onBlur={() => setPassFocused(false)}
          placeholder="••••••••••••"
          autoComplete="current-password"
          required
          disabled={loading}
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className="login-input"
        />
      </div>

      <div className="login-submit-wrap">
        <button type="submit" disabled={loading} className="login-submit">
          {loading ? (
            <>
              <svg
                className="login-spinner"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="6"
                  cy="6"
                  r="4.5"
                  stroke="rgb(var(--accent-rgb) / 0.25)"
                  strokeWidth="1.5"
                />
                <path
                  d="M6 1.5A4.5 4.5 0 0 1 10.5 6"
                  stroke="var(--color-accent-base)"
                  strokeWidth="1.5"
                  strokeLinecap="butt"
                />
              </svg>
              Verifying...
            </>
          ) : (
            "Sign in"
          )}
        </button>

        {error && (
          <p id="login-error" role="alert" className="login-error">
            {error}
          </p>
        )}

        {isGatingRelaxed() && (
          <button
            type="button"
            disabled={loading}
            className="login-dev-btn"
            onClick={handleDevSignIn}
          >
            Dev sign in
          </button>
        )}
      </div>
    </form>
  );
}
