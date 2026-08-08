"use client";

/**
 * Sign-in, by printed slip.
 *
 * This replaces an email + one-time-code flow that assumed candidates have
 * mailboxes the platform can reach. They do not: a roster of exam candidates
 * arrives as names, credentials are provisioned in bulk, and each person is
 * handed a piece of paper. There is no reset link to click and no inbox to
 * check, so there is nothing for an OTP to be delivered to.
 *
 * Credentials are contest-scoped, so a successful sign-in already says which
 * contest this is. Nothing here asks for a session code.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProctorApiError, studentLogin } from "@/lib/proctor-api";
import { BrandPane } from "./components/BrandPane";
import { SlipForm } from "./components/SlipForm";

export default function LoginPage() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError(null);
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
        setError("Cannot reach the exam server. Check the network, or ask an invigilator.");
        return;
      }
      // The server's own wording. It already distinguishes "incorrect",
      // "revoked" and "too many attempts" carefully, and paraphrasing it here
      // would lose the difference at exactly the moment it matters.
      setError(caught.message);
    }
  }

  return (
    <div className="login-root">
      <BrandPane />

      <div className="login-right" style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 16, right: 16, zIndex: 1 }}>
          <ThemeToggle />
        </div>
        <div className="login-form-wrap">
          <div className="login-form-title">Sign in</div>
          <div className="login-form-sub">Use the login ID and password on your printed slip.</div>
          <div className="login-rule" />

          <SlipForm
            loginId={loginId}
            setLoginId={setLoginId}
            password={password}
            setPassword={setPassword}
            loading={loading}
            error={error}
            onSubmit={handleSubmit}
          />

          <p className="login-form-note">
            This exam is proctored to keep it fair. After you sign in, we&rsquo;ll set up your
            camera and check your device.
          </p>

          <div
            className="login-form-support"
            style={{ display: "flex", gap: 16, flexWrap: "wrap" }}
          >
            {/* No password reset. A slip cannot be recovered, only reissued —
                the server stores a hash and genuinely cannot tell anyone what
                the password was. An invigilator issues a new one. */}
            <span className="login-form-hint">
              Lost your slip? An invigilator can issue a new one.
            </span>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="login-textlink login-textlink--quiet"
            >
              Can&apos;t sign in? Get help
            </button>
          </div>
        </div>
      </div>

      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind="LOGIN"
        summary="I can't sign in to AMS Access."
        details={{
          source: "login",
          // The login id is on a slip and is not a secret; it is the one thing
          // that lets an invigilator find the right candidate. The password is
          // never included.
          attempted_login_id: loginId.trim() || undefined,
          last_error: error,
        }}
      />
    </div>
  );
}
