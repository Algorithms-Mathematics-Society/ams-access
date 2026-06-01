import type { Metadata } from "next";
import { LegalList, LegalPage, P } from "../legal-page";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy · AMS Access",
  description: "Privacy information for the AMS Access secure exam shell.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="AMS Access Legal"
      title="Privacy Policy"
      description="This policy explains what the AMS Access desktop shell may collect while preparing for or running a secured contest session."
      effectiveDate="May 27, 2026"
      sections={[
        {
          title: "Scope",
          body: (
            <>
              <P>
                AMS Access is the secured desktop client used for AMS contest and assessment
                sessions. It runs a Next.js interface inside a Tauri desktop shell and uses native
                operating-system checks to confirm that a device is ready for a locked session.
              </P>
              <P>
                Your contest organizer may have additional privacy terms for registration,
                grading, leaderboard publication, identity verification, and support. Those
                organizer terms apply in addition to this client policy.
              </P>
            </>
          ),
        },
        {
          title: "Information We Process",
          body: (
            <>
              <P>Depending on the session configuration, AMS Access may process:</P>
              <LegalList
                items={[
                  "Account identifiers such as the signed-in email address and organization context.",
                  "Contest identifiers, invite code status, active session identifiers, answers, submissions, heartbeat status, and timestamps.",
                  "Device readiness signals such as operating system, CPU architecture, display/session environment, camera and microphone availability, network latency, and jitter.",
                  "Security signals such as restricted process names, virtualization indicators, keyboard lockdown capability, local injection checks, and session violation events.",
                  "Media permission results, live camera or microphone streams, and local face calibration snapshots used for readiness checks and proctoring features.",
                  "Diagnostic report data that you choose to export or send through support flows, including OS, architecture, display server, media availability, latency, jitter, VM/security results, and keyboard readiness.",
                ]}
              />
              <P>
                The current client stores some session state locally in browser storage so that a
                contestant can resume after a refresh or crash. Some violation records are currently
                held in memory by the desktop shell unless a backend integration for a session sends
                them onward.
              </P>
            </>
          ),
        },
        {
          title: "How Information Is Used",
          body: (
            <LegalList
              items={[
                "To identify the signed-in contestant context and show available, live, completed, or blocked sessions.",
                "To run pre-session readiness checks and explain failed camera, microphone, network, process, virtualization, or platform checks.",
                "To enforce contest integrity rules, including fullscreen/lockdown behavior, process scanning, keyboard interception where supported, and network restrictions where enabled.",
                "To recover interrupted active sessions and support troubleshooting.",
                "To send submissions, session heartbeats, incident reports, and diagnostic data to the configured AMS contest services when those integrations are available.",
              ]}
            />
          ),
        },
        {
          title: "Camera, Microphone, and Proctoring",
          body: (
            <>
              <P>
                AMS Access requests camera and microphone access only through the browser or desktop
                permission system. The app may use those streams to test hardware, confirm presence,
                calibrate face alignment, monitor audio readiness, and support proctored contest
                rules.
              </P>
              <P>
                During face calibration, the client may save a local face snapshot in the operating
                system temporary directory, such as <code>/tmp/ams_faces</code> on Linux/macOS or{" "}
                <code>%TEMP%\ams_faces</code> on Windows. These local files are used for session
                calibration and should be treated as temporary app data; exact cleanup can depend on
                the operating system, crash state, and organizer build.
              </P>
              <P>
                The repository includes local media analysis and readiness checks. Any remote media
                upload, frame archiving, or long-term proctoring retention depends on the organizer
                and backend services used for a particular contest.
              </P>
            </>
          ),
        },
        {
          title: "Local System Controls",
          body: (
            <P>
              During a secured session, AMS Access may use native operating-system capabilities to
              keep the exam window in focus, scan running processes, detect virtualized
              environments, and restrict outbound network access to approved hosts. Some controls,
              such as Linux keyboard settings, include crash-recovery restore paths. Network
              firewall rules may persist after a crash until the client or an administrator runs the
              matching unlock/restore action.
            </P>
          ),
        },
        {
          title: "Network Probes",
          body: (
            <P>
              Readiness checks may contact the configured AMS API host to measure reachability. Some
              onboarding flows can use a fallback connectivity URL, such as Google's{" "}
              <code>generate_204</code> endpoint, to distinguish a local network outage from an AMS
              service outage. Those third-party probes can reveal normal request metadata such as IP
              address, time, and user agent to the endpoint operator.
            </P>
          ),
        },
        {
          title: "Sharing",
          body: (
            <P>
              Contest data may be shared with the contest organizer, platform administrators,
              judging infrastructure, and service providers needed to operate authentication,
              storage, networking, diagnostics, and support. AMS Access does not sell contestant
              personal information.
            </P>
          ),
        },
        {
          title: "Retention and Deletion",
          body: (
            <P>
              Signing out removes the saved account email from this client, but other local keys,
              such as active-session recovery state or interface preferences, may remain until app
              data is cleared. Server-side contest records, submissions, audit logs, and support
              reports are retained according to the organizer's policy and the backend configuration
              for that contest.
            </P>
          ),
        },
        {
          title: "Contact",
          body: (
            <P>
              For privacy questions, contact the contest organizer or AMS platform administrator
              that provided your session invitation.
            </P>
          ),
        },
      ]}
    />
  );
}
