"use client";

import { useState } from "react";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { getContestSponsor, type ContestSponsor as Sponsor } from "@/lib/contest-sponsors";

type Placement = "home" | "introduction" | "waiting" | "completion";

/** Supporting identity, never an action or an ad. All current placements use
 * the existing dark-locked contest surfaces, suited to the supplied white logo.
 * Budget: 28px wordmark on Home/receipt; 32px before entry. Wrap at narrow widths.
 */
export function ContestSponsor({
  contestId,
  placement,
}: {
  contestId: string | null | undefined;
  placement: Placement;
}) {
  const sponsor = getContestSponsor(contestId);
  if (!sponsor) return null;
  return (
    <SponsorIdentity
      key={`${contestId}:${sponsor.logoSrc}`}
      sponsor={sponsor}
      placement={placement}
    />
  );
}

function SponsorIdentity({ sponsor, placement }: { sponsor: Sponsor; placement: Placement }) {
  const [imageFailed, setImageFailed] = useState(false);
  const prominent = placement === "introduction" || placement === "waiting";
  const height = prominent ? "var(--spacing-8)" : "calc(var(--spacing-6) + var(--spacing-1))";
  return (
    <HStack
      data-contest-sponsor={placement}
      gap={3}
      align="center"
      wrap="wrap"
      style={{ minWidth: 0, paddingTop: prominent ? "var(--spacing-3)" : undefined }}
    >
      <Text type="supporting" color="secondary">
        {placement === "completion" ? "This round was supported by" : "Sponsored by"}
      </Text>
      <HStack align="center" style={{ height, minWidth: 0, maxWidth: "100%" }}>
        {imageFailed ? (
          <Text weight="medium">{sponsor.name}</Text>
        ) : (
          <img
            src={sponsor.logoSrc}
            alt={sponsor.name}
            width={sponsor.logoWidth}
            height={sponsor.logoHeight}
            decoding="async"
            draggable={false}
            onError={() => setImageFailed(true)}
            style={{
              display: "block",
              height,
              width: "auto",
              maxWidth: "100%",
              objectFit: "contain",
            }}
          />
        )}
      </HStack>
    </HStack>
  );
}
