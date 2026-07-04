export function BrandPane() {
  return (
    <div className="login-left">
      <div className="login-logo">
        <svg
          width="20"
          height="20"
          viewBox="0 0 172 162"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M2.00043 162L87.0004 2L172 162"
            stroke="var(--color-accent-base)"
            strokeWidth="6"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
        <div className="login-logo-label">
          <span className="login-logo-name">AMS Access</span>
          <span className="login-logo-sub">Exam workspace</span>
        </div>
      </div>

      <div className="login-brand">
        <div className="login-brand-mark">
          <svg
            width="56"
            height="53"
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
        </div>

        <h2 className="login-brand-headline">
          Your contest.
          <br />
          <em>Made fair.</em>
        </h2>
        <p className="login-brand-sub">
          A calm, fair space for your coding contest, so your work is the only thing that counts.
        </p>

        <div className="login-brand-features">
          <div className="login-brand-feature">
            <div className="login-brand-feature-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-accent-base)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="login-brand-feature-text">
              <span className="login-brand-feature-label">Distraction-free</span>
              <span className="login-brand-feature-desc">
                Other apps and shortcuts pause during the exam, so everyone competes on equal
                footing.
              </span>
            </div>
          </div>

          <div className="login-brand-feature">
            <div className="login-brand-feature-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-accent-base)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
              </svg>
            </div>
            <div className="login-brand-feature-text">
              <span className="login-brand-feature-label">Fair for everyone</span>
              <span className="login-brand-feature-desc">
                A quick camera check confirms you&rsquo;re present during the exam.
              </span>
            </div>
          </div>

          <div className="login-brand-feature">
            <div className="login-brand-feature-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-accent-base)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div className="login-brand-feature-text">
              <span className="login-brand-feature-label">Instant feedback</span>
              <span className="login-brand-feature-desc">
                Your code is checked the moment you submit.
              </span>
            </div>
          </div>
        </div>

        <div className="login-brand-footer">AMS Access · Fair, secure exams</div>
      </div>
    </div>
  );
}
