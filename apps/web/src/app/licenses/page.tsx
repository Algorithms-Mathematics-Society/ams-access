import type { Metadata } from "next";
import { LegalList, LegalPage, P } from "../legal-page";

export const metadata: Metadata = {
  title: "Open Source Licenses · AMS Access",
  description: "Open source notices for the AMS Access secure exam shell.",
};

export default function LicensesPage() {
  return (
    <LegalPage
      eyebrow="AMS Access Legal"
      title="Open Source Licenses"
      description="AMS Access is built with open source software across the web interface, desktop shell, and Rust platform modules."
      effectiveDate="May 27, 2026"
      sections={[
        {
          title: "Rust Workspace License",
          body: (
            <P>
              The Rust workspace metadata for AMS Access declares the Rust crates under the MIT
              license. The private JavaScript package manifests do not currently declare a separate
              package license. Some packages and generated assets may have separate notices from
              their upstream projects.
            </P>
          ),
        },
        {
          title: "Primary Web Dependencies",
          body: (
            <LegalList
              items={[
                "Next.js, React, and React DOM for the web application runtime.",
                "TypeScript for type checking and development tooling.",
                "Tailwind CSS for styling infrastructure.",
                "Framer Motion for animation primitives.",
                "MediaPipe Tasks Vision, TensorFlow.js core, TensorFlow.js CPU backend, and BlazeFace for local camera and face-readiness workflows.",
              ]}
            />
          ),
        },
        {
          title: "Desktop and Native Dependencies",
          body: (
            <LegalList
              items={[
                "Tauri and related Rust crates for the desktop shell, command bridge, window control, and bundling.",
                "Tokio and supporting Rust ecosystem crates for asynchronous native checks.",
                "Operating-system facilities provided by Linux, Windows, and macOS for process scanning, keyboard handling, environment checks, firewall controls, and diagnostics.",
                "Native webview and system libraries, such as WebKit/GTK stacks on Linux, may carry additional system-library licenses and distribution obligations outside the Rust crate metadata.",
              ]}
            />
          ),
        },
        {
          title: "License Families",
          body: (
            <P>
              The dependency set commonly includes permissive open source licenses such as MIT,
              Apache-2.0, BSD-style licenses, ISC, and Unicode-related data licenses. Exact license
              obligations can change when dependencies are updated.
            </P>
          ),
        },
        {
          title: "Source and Lockfiles",
          body: (
            <P>
              For a practical dependency list for a specific build, review the package manifests and
              lockfiles included with that build, including <code>package.json</code>,{" "}
              <code>pnpm-lock.yaml</code>, <code>Cargo.toml</code>, and <code>Cargo.lock</code>.
              Lockfiles can contain stale or transitive entries, so generated third-party notice
              bundles should be treated as the authoritative release artifact when available.
            </P>
          ),
        },
        {
          title: "Notice Preservation",
          body: (
            <P>
              When redistributing AMS Access, preserve copyright notices, license texts, and any
              attribution files required by third-party projects. If a packaged build includes a
              generated third-party notice bundle, that bundle controls for the exact artifacts in
              that release.
            </P>
          ),
        },
      ]}
    />
  );
}
