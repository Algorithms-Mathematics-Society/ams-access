/** Release locally before navigation; missing native status is never success. */
import { releaseDeviceControls } from "./release-device-controls";

let navigation: Promise<void> | null = null;
export function exitToHome(
  router: { push: (href: string) => void },
  destination = "/home"
): Promise<void> {
  if (navigation) return navigation;
  const current = releaseDeviceControls().then((result) => {
    router.push(
      result.outcome === "confirmed" || result.outcome === "browser"
        ? destination
        : "/home?restore=pending"
    );
  });
  navigation = current;
  void current.then(
    () => {
      if (navigation === current) navigation = null;
    },
    () => {
      if (navigation === current) navigation = null;
    }
  );
  return current;
}
