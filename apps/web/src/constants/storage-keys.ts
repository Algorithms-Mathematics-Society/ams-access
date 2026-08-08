export const STORAGE_KEYS = {
  ACTIVE_SESSION: "ams_active_session",
  UNLOCKED_CONTESTS: "ams_unlocked_contests",
  DEVICE_ID: "ams_device_id",
  // The contest the slip was issued for, and who the slip belongs to. Sign-in
  // is by printed slip now: candidates have no mailbox the platform can
  // reach, and an email address was never an identifier this system had.
  ACTIVE_CONTEST: "ams_active_contest",
  ACTIVE_CONTEST_TITLE: "ams_active_contest_title",
  DISPLAY_NAME: "ams_display_name",

  // DEPRECATED. Nothing writes these any more — the slip login replaced the
  // email flow. They remain because `home/` and `results/` still read them,
  // and those pages are still pointed at the retired backend; they go when
  // those pages are moved onto the participant API. Anything reading one of
  // these is, by definition, not yet migrated.
  USER_EMAIL: "ams_user_email",
  USER_DISPLAY_EMAIL: "ams_user_display_email",
  THEME: "ams_theme",
  CANDIDATE_TOKEN: "ams_candidate_token",
} as const;
