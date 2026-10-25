"use client";

import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { exitToHome } from "@/lib/exit-to-home";

export interface BackToHomeButtonProps {
  label?: string;
  variant?: "primary" | "secondary";
  destination?: string;
}

/** Goes home after putting back every setting lockdown or setup changed. */
export function BackToHomeButton({
  label = "Back to Home",
  variant = "secondary",
  destination,
}: BackToHomeButtonProps) {
  const router = useRouter();
  return (
    <Button label={label} variant={variant} clickAction={() => exitToHome(router, destination)} />
  );
}
