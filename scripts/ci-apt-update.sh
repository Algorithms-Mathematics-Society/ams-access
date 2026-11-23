#!/bin/sh
# Refresh apt indexes from whichever public Ubuntu mirror is answering (CI only).
#
# archive.ubuntu.com and azure.archive.ubuntu.com have each stalled the Linux
# jobs on different days: Azure once sat 38 minutes unanswered, and on
# 2026-11-23 archive.ubuntu.com refused connections and then trickled until the
# Deb smoke was cancelled. Retrying one mirror does not help when it is slow
# rather than failing, so alternate between them.
#
# Run as root, on a runner or inside an ubuntu container.
# APT_UPDATE_TIMEOUT (seconds per attempt) defaults to 180.
set -u

per_attempt=${APT_UPDATE_TIMEOUT:-180}
printf 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\n' > /etc/apt/apt.conf.d/80-ci-network

for mirror in http://archive.ubuntu.com http://azure.archive.ubuntu.com \
              http://archive.ubuntu.com http://azure.archive.ubuntu.com; do
  # deb822 sources, classic lists and the mirror lists current runners use.
  find /etc/apt -maxdepth 2 -type f \
    \( -name sources.list -o -name '*.list' -o -name '*.sources' -o -name 'apt-mirrors*.txt' \) \
    -exec sed -i -E "s#https?://(azure\.)?(archive|security)\.ubuntu\.com#$mirror#g" {} +
  # --error-on=any: by default a failed index fetch is only a warning (exit 0),
  # which would report success and leave the install to fail later.
  if timeout "$per_attempt" apt-get update --error-on=any; then
    echo "apt indexes refreshed from $mirror"
    exit 0
  fi
  echo "apt-get update failed or stalled on $mirror; trying the other mirror"
  # A half-written index makes the next attempt fail for a different reason.
  rm -rf /var/lib/apt/lists/*
  sleep 5
done
echo "::error::no Ubuntu mirror answered apt-get update"
exit 1
