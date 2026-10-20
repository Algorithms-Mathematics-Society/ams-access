"use client";
import { useRouter } from "next/navigation";
import WelcomeScreen from "./WelcomeScreen";
import { StartupAnimation } from "@/components/StartupAnimation";
export default function RootPage() {
  const router = useRouter();
  return (
    <StartupAnimation>
      <WelcomeScreen onEnter={() => router.push("/login")} />
    </StartupAnimation>
  );
}
