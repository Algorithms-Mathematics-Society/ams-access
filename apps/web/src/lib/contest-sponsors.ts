/** Local, contest-scoped test branding. Not organizer or sponsorship entitlement data.
 * Only this existing browser-preview contest is opted in; unknown IDs stay unbranded.
 * Remove the entry after the sponsorship demo, or replace it with approved API metadata.
 */
export type ContestSponsor = {
  name: string;
  logoSrc: string;
  logoWidth: number;
  logoHeight: number;
};

const TEST_CONTEST_SPONSORS: Readonly<Record<string, ContestSponsor>> = {
  "p0-contest": {
    name: "Jane Street",
    logoSrc: "/sponsors/jane-street-white.svg",
    logoWidth: 714,
    logoHeight: 197,
  },
};

export function getContestSponsor(contestId: string | null | undefined): ContestSponsor | null {
  if (!contestId || !Object.hasOwn(TEST_CONTEST_SPONSORS, contestId)) return null;
  return TEST_CONTEST_SPONSORS[contestId];
}
