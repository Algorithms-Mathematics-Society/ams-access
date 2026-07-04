import { type Dispatch, type SetStateAction } from "react";

export interface OtpFormProps {
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  emailFocused: boolean;
  setEmailFocused: Dispatch<SetStateAction<boolean>>;
  otpStep: "email" | "code";
  setOtpStep: Dispatch<SetStateAction<"email" | "code">>;
  otpCode: string;
  setOtpCode: Dispatch<SetStateAction<string>>;
  otpState: "idle" | "sending" | "verifying";
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  handleSendOtp: () => Promise<void>;
  handleVerifyOtp: () => Promise<void>;
}

export function OtpForm({
  email,
  setEmail,
  emailFocused,
  setEmailFocused,
  otpStep,
  setOtpStep,
  otpCode,
  setOtpCode,
  otpState,
  error,
  setError,
  handleSendOtp,
  handleVerifyOtp,
}: OtpFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (otpStep === "email") void handleSendOtp();
        else void handleVerifyOtp();
      }}
      noValidate
    >
      <div className="login-field">
        <label
          htmlFor="login-email-otp"
          className={`login-label${emailFocused ? " login-label--focused" : ""}`}
        >
          Email
        </label>
        <input
          id="login-email-otp"
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
          disabled={otpStep === "code" || otpState !== "idle"}
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className="login-input"
        />
      </div>

      {otpStep === "code" && (
        <div className="login-field">
          <label htmlFor="login-otp-code" className="login-label">
            6-digit code
          </label>
          <input
            id="login-otp-code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otpCode}
            onChange={(e) => {
              setError(null);
              setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            placeholder="••••••"
            autoComplete="one-time-code"
            aria-describedby={error ? "login-error" : undefined}
            aria-invalid={error ? "true" : undefined}
            className="login-input"
            style={{ letterSpacing: "0.3em" }}
          />
          <p className="login-form-note" style={{ marginTop: 8 }}>
            We emailed a code to {email.trim() || "your inbox"}. It expires in 10 minutes.
          </p>
        </div>
      )}

      <div className="login-submit-wrap">
        <button type="submit" disabled={otpState !== "idle"} className="login-submit">
          {otpState === "sending"
            ? "Sending code..."
            : otpState === "verifying"
              ? "Verifying..."
              : otpStep === "email"
                ? "Send code"
                : "Verify & sign in"}
        </button>

        {error && (
          <p id="login-error" role="alert" className="login-error">
            {error}
          </p>
        )}

        {otpStep === "code" && (
          <button
            type="button"
            className="login-dev-btn"
            disabled={otpState !== "idle"}
            onClick={() => {
              setOtpStep("email");
              setOtpCode("");
              setError(null);
            }}
          >
            Use a different email
          </button>
        )}
      </div>
    </form>
  );
}
