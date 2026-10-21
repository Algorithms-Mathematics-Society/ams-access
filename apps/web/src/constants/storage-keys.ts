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
  // The session just finished. `ACTIVE_SESSION` is cleared at exit teardown —
  // correctly, it is no longer active — but the results screen still needs to
  // know which session's submissions to show, and it opens *after* that.
  LAST_SESSION: "ams_last_session",

  // The camera the candidate picked, by deviceId.
  //
  // Onboarding used to open whatever the OS called the default, which on a
  // Windows-Hello laptop is often the infrared sensor: a grey, near-black
  // image the face check can never pass. Settings had a picker whose value
  // was read by nothing. One key, honoured everywhere a camera is opened.
  PREFERRED_CAMERA: "ams_preferred_camera",

  THEME: "ams_theme",
} as const;
