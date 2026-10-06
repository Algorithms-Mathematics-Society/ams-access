"use client";

import { useState, type ReactNode, type SVGProps } from "react";
import { LogOut } from "lucide-react";
import { AppShell, useAppShellMobile } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { LayoutPanel } from "@astryxdesign/core/Layout";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { ThemeToggle } from "@/components/ThemeToggle";

function AccessMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none">
      <path
        d="M3 21 12 3 21 21"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Destination = "overview" | "settings" | "diagnostics";
const destinations = [
  { id: "overview", label: "Home" },
  { id: "settings", label: "Settings" },
  { id: "diagnostics", label: "Device" },
] as const;

export function DashboardShell({
  activeNav,
  onNavigate,
  displayName,
  onSignOut,
  signingOut,
  headerAction,
  calendar,
  children,
}: {
  activeNav: Destination;
  onNavigate: (nav: Destination) => void;
  displayName: string;
  onSignOut: () => void;
  signingOut: boolean;
  headerAction?: ReactNode;
  calendar?: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = (nav: Destination) => {
    onNavigate(nav);
    setMobileOpen(false);
  };
  // Desktop: 280px labeled navigation/schedule panel, 24px main gutters,
  // fluid contest list and 320px readiness. Below 1024px the calendar moves
  // into the main flow and the navigation becomes a drawer.
  return (
    <AppShell
      variant="section"
      height="fill"
      contentPadding={0}
      style={{ background: "var(--color-background-body)" }}
      mobileNav={{ isOpen: mobileOpen, onOpenChange: setMobileOpen, breakpoint: "lg" }}
      topNav={
        <TopNav
          label="Account"
          heading={
            <TopNavHeading heading="Access" logo={<Icon icon={AccessMark} color="accent" />} />
          }
          endContent={
            <HStack gap={2} align="center">
              <ThemeToggle />
              <Button
                label={signingOut ? "Signing out..." : "Sign out"}
                variant="ghost"
                isDisabled={signingOut}
                onClick={onSignOut}
                icon={<Icon icon={LogOut} size="sm" />}
              />
            </HStack>
          }
        />
      }
      sideNav={<WorkspacePanel activeNav={activeNav} onNavigate={navigate} calendar={calendar} />}
    >
      <VStack
        gap={6}
        width="100%"
        maxWidth="calc(var(--spacing-10) * 36)"
        style={{
          marginInline: "auto",
          padding: "clamp(var(--spacing-4), 3vw, var(--spacing-6))",
        }}
      >
        <HStack gap={4} justify="between" align="end" wrap="wrap">
          <VStack
            gap={2}
            style={{
              minWidth: 0,
              flex: activeNav === "settings" ? "1 1 calc(var(--spacing-10) * 6)" : 1,
            }}
          >
            <Text type="supporting" maxLines={1}>
              {displayName || "Your workspace"}
            </Text>
            <Heading level={1} type={activeNav === "overview" ? "display-2" : undefined}>
              {activeNav === "overview"
                ? "Your contests"
                : activeNav === "settings"
                  ? "Settings"
                  : "Device diagnostics"}
            </Heading>
            <Text color="secondary">
              {activeNav === "overview"
                ? "Your next challenge starts here."
                : activeNav === "settings"
                  ? "Camera, microphone, security policies, and device settings."
                  : "Review your setup, inspect device checks, and get help with troubleshooting."}
            </Text>
          </VStack>
          {headerAction}
        </HStack>
        {children}
        <MobileCalendar>{calendar}</MobileCalendar>
      </VStack>
    </AppShell>
  );
}

export function DashboardColumns({
  children,
  readiness,
}: {
  children: ReactNode;
  readiness: ReactNode;
}) {
  return (
    <HStack gap={6} align="start" wrap="wrap">
      <VStack gap={6} style={{ flex: "999 1 calc(var(--spacing-10) * 12)", minWidth: 0 }}>
        {children}
      </VStack>
      <VStack
        as="aside"
        aria-label="Device readiness"
        style={{ flex: "1 1 calc(var(--spacing-10) * 8)", minWidth: 0 }}
        maxWidth="100%"
      >
        {readiness}
      </VStack>
    </HStack>
  );
}

function WorkspacePanel({
  activeNav,
  onNavigate,
  calendar,
}: {
  activeNav: Destination;
  onNavigate: (nav: Destination) => void;
  calendar?: ReactNode;
}) {
  const { isMobile } = useAppShellMobile();
  return (
    <LayoutPanel padding={2} width="calc(var(--spacing-10) * 7)" isScrollable={false}>
      <VStack gap={6}>
        <SideNav style={{ width: "100%", height: "auto", minHeight: 0 }}>
          <SideNavSection title="Workspace">
            {destinations.map((item) => (
              <SideNavItem
                key={item.id}
                label={item.label}
                isSelected={activeNav === item.id}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </SideNavSection>
        </SideNav>
        {!isMobile && calendar}
      </VStack>
    </LayoutPanel>
  );
}

function MobileCalendar({ children }: { children?: ReactNode }) {
  const { isMobile } = useAppShellMobile();
  return isMobile && children ? (
    <VStack maxWidth="calc(var(--spacing-10) * 10)">{children}</VStack>
  ) : null;
}
