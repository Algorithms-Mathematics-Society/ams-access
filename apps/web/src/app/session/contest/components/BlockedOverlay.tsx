import { type RefObject } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Banner } from "@astryxdesign/core/Banner";
import { ContestOverlay } from "./ContestOverlay";
export interface LockGraceToastProps { lockGraceCountdown: number; }
export function LockGraceToast({ lockGraceCountdown }: LockGraceToastProps) {
  return <VStack role="status" style={{ position: "fixed", top: "calc(var(--spacing-10) * 2)", left: "50%", transform: "translateX(-50%)", zIndex: "var(--modal-z-base)", width: "min(calc(100% - var(--spacing-8)), calc(var(--spacing-10) * 12))" }}><Banner status="warning" title="Restricted application detected" description={`Workspace locking in ${lockGraceCountdown}s. Please save your work immediately.`} /></VStack>;
}
export interface BlockedAppsOverlayProps { lockViolationDialogRef: RefObject<HTMLDivElement | null>; blockedApps: string[]; }
export function BlockedAppsOverlay({ lockViolationDialogRef, blockedApps }: BlockedAppsOverlayProps) {
  return <ContestOverlay labelId="blocked-app-title" critical alert dialogRef={lockViolationDialogRef}><Heading level={2} id="blocked-app-title">Restricted application detected</Heading><Text color="secondary">To maintain exam security, please close the applications listed below.</Text><VStack as="ul" gap={0} style={{ listStyle: "none", padding: 0, margin: 0 }}>{blockedApps.map(app => <VStack as="li" key={app} style={{ paddingBlock: "var(--spacing-3)", borderBottom: "var(--border-width) solid var(--color-border)", overflowWrap: "anywhere" }}><Text>{app}</Text></VStack>)}</VStack><Text type="supporting" color="secondary">This dialog will dismiss automatically once the app is closed.</Text></ContestOverlay>;
}
