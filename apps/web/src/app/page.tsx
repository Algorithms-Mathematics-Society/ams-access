"use client";
import { useRouter } from "next/navigation";
import WelcomeScreen from "./WelcomeScreen";
export default function RootPage() {
  const router = useRouter();
  return <WelcomeScreen onEnter={() => router.push("/login")} />;
}
