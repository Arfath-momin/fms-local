#!/bin/sh
set -eu

# Final launch step, shared by both deployment paths: it is the image's CMD
# under compose, and scripts/start-prod.sh execs it after migrations on Railway.
#
# It exists to solve one problem. A mounted volume replaces whatever the image
# had at that path, ownership included — so the build-time `chown` of
# /app/uploads in the Dockerfile is masked the instant a volume is attached, and
# both Docker named volumes and Railway volumes arrive owned by root. Running as
# an unprivileged user, the first bill upload then dies with
# `EACCES: permission denied, mkdir '/app/uploads/<year>'`.
#
# So the container now starts as root, fixes ownership of the mount, and drops
# to the runtime user before exec'ing the server. Nothing application-facing
# ever runs privileged; the `su-exec` line is the last thing root does.

# Same precedence as uploadsRoot() in src/lib/attachments.ts. Keep the two in
# step: chowning a directory the app does not write to would fix nothing.
UPLOADS="${UPLOADS_DIR:-${RAILWAY_VOLUME_MOUNT_PATH:-/app/uploads}}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOADS"
  # -R because a volume restored from backup can carry foreign ownership
  # throughout, not just at its root.
  chown -R nextjs:nodejs "$UPLOADS"
  echo "Uploads root ${UPLOADS} ready; dropping to nextjs."
  echo "Starting Next.js server on [${HOSTNAME:-0.0.0.0}]:${PORT:-3000}..."
  exec su-exec nextjs:nodejs node server.js
fi

# Already unprivileged (someone set `user:` on the service, or ran the image
# with --user). Nothing can be fixed from here, so just start and let a genuine
# permission problem surface in the logs rather than being silently swallowed.
echo "Starting Next.js server on [${HOSTNAME:-0.0.0.0}]:${PORT:-3000} as $(id -un)..."
exec node server.js
