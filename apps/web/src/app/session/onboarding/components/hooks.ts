import { useEffect, useState } from "react";

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = localStorage.getItem("ams_theme") as "dark" | "light";
    if (saved) setTheme(saved);
  }, []);
  return theme;
}
