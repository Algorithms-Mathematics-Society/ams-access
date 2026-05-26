import type { Metadata } from "next";
import { LegalList, LegalPage, P } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Service · AMS Access",
  description: "Terms for using the AMS Access secure exam shell.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="AMS Access Legal"
      title="Terms of Service"
      description="These terms describe the rules for using AMS Access during secured contests and assessments."
      effectiveDate="May 27, 2026"
      sections={[
        {
          title: "Acceptance",
          body: (
            <P>
              By signing in to AMS Access, joining a session, or continuing through the secure
              onboarding flow, you agree to follow these terms and any contest rules provided by
              your organizer.
            </P>
          ),
        },
        {
          title: "Permitted Use",
          body: (
            <P>
              AMS Access is provided for authorized contestants and session participants to enter
              AMS contests and assessments through the secure desktop shell. You may use the client
              only for sessions for which you are invited, registered, or otherwise approved.
            </P>
          ),
        },
        {
          title: "Contestant Responsibilities",
          body: (
            <LegalList
              items={[
                "Use your own account and do not share session credentials, invite codes, or active session links.",
                "Keep the AMS Access window active during secured sessions unless the app or organizer instructs otherwise.",
                "Close restricted applications, remote access tools, screen recorders, communication apps, debuggers, packet tools, virtual machines, and other blocked software before joining; detected use may trigger review or removal even if the client permits you to continue.",
                "Provide required camera, microphone, network, and device permissions for sessions that require them. A failed or bypassed readiness check may still be reviewed by the organizer.",
                "Do not attempt to bypass lockdown controls, alter telemetry, tamper with the app, or interfere with judging and proctoring systems.",
                "Report crashes, hardware failures, network problems, or mistaken security flags through the provided support flow or to the organizer.",
              ]}
            />
          ),
        },
        {
          title: "Security Controls",
          body: (
            <P>
              During a session, AMS Access may enable fullscreen or always-on-top behavior, scan
              running processes, detect virtualization, check the local security environment, test
              network reachability, request camera and microphone access, log violation events, and
              apply platform-specific lockdown controls. Some controls vary by operating system and
              may require elevated privileges or user-granted permissions.
            </P>
          ),
        },
        {
          title: "Submissions and Session Data",
          body: (
            <P>
              Source code, answers, incident reports, heartbeats, diagnostic metadata, and security
              events may be transmitted to the configured AMS contest services. Contest organizers
              may use this information for scoring, support, integrity review, audit, and dispute
              resolution. Some local violation data may remain in memory or local recovery state
              unless a session integration sends it to backend services.
            </P>
          ),
        },
        {
          title: "Organizer Authority and Responsibilities",
          body: (
            <P>
              Contest organizers are responsible for session configuration, eligibility decisions,
              contest instructions, allowed and restricted tools, support handling, review of
              security flags, retention policies, and dispute processes. AMS Access enforces the
              configured client-side controls, but organizers remain responsible for communicating
              the rules that apply to their event.
            </P>
          ),
        },
        {
          title: "Availability",
          body: (
            <P>
              AMS Access is under active development. The client and its connected services may be
              unavailable, interrupted, or changed. The app should not be treated as a guarantee
              that every prohibited action can be prevented on every device or operating system.
            </P>
          ),
        },
        {
          title: "Updates",
          body: (
            <P>
              A contest organizer may require a current version of AMS Access before allowing entry
              to a secured session. You are responsible for installing required updates and
              completing readiness checks before the session begins.
            </P>
          ),
        },
        {
          title: "Disclaimers and Limitations",
          body: (
            <P>
              AMS Access is provided as a secured contest client and diagnostics tool, not as a
              guarantee of uninterrupted access, perfect detection, or a particular contest outcome.
              Hardware failures, denied permissions, network disruption, operating-system limits,
              organizer configuration, or service outages can affect access and submissions. To the
              extent permitted by applicable law, the client is provided without warranties and AMS
              and the organizer are not responsible for indirect, incidental, or consequential
              losses arising from use of the client.
            </P>
          ),
        },
        {
          title: "Termination or Removal",
          body: (
            <P>
              Access to a session may be blocked, suspended, or reviewed if eligibility fails,
              restricted tools are detected, security controls are bypassed, required permissions
              are denied, or the organizer determines that contest rules may have been violated.
            </P>
          ),
        },
        {
          title: "Governing Rules",
          body: (
            <P>
              If these terms conflict with specific written contest instructions, honor the stricter
              requirement unless the organizer tells you otherwise.
            </P>
          ),
        },
      ]}
    />
  );
}
