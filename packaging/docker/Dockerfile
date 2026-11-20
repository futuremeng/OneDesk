# OneDesk headless batch conversion image (the batch-conversion slice of
# the Docker ask, onedesk#1808; sibling of packaging/flatpak and
# packaging/nix): wraps the official release deb and drives the app's own
# --headless-export entry point per file under Xvfb. No OneDesk source is
# rebuilt here, so the conversion behavior is bit-for-bit the release's.
#
# Build:
#   docker build -t onedesk-batch packaging/docker
# Convert every convertible document under ./docs into ./pdf:
#   docker run --rm -v "$PWD/docs:/data:ro" -v "$PWD/pdf:/output" onedesk-batch
# See packaging/docker/README.md for the knobs.
#
# On a new release bump ONEDESK_VERSION and ONEDESK_DEB_SHA256.

FROM debian:bookworm-slim

ARG ONEDESK_VERSION=0.11.0
ARG ONEDESK_DEB_SHA256=a59241bd30dcee12314990f7d438ec2bc4a5e93c5c1c242b203361529dc44c29

# The deb's own Depends line pulls in the Electron runtime libraries (nss,
# gtk, alsa, ...); curl is build-time only. fonts-noto-cjm/-core/-emoji so
# headless renders do not fall back to tofu for CJK documents — mount extra
# fonts into /usr/local/share/fonts for anything exotic.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL -o /tmp/onedesk.deb \
       "https://onedesk.jiulu.ltd/releases/download/v${ONEDESK_VERSION}/onedesk_${ONEDESK_VERSION}_amd64.deb" \
  && echo "${ONEDESK_DEB_SHA256}  /tmp/onedesk.deb" | sha256sum -c - \
  && apt-get install -y --no-install-recommends /tmp/onedesk.deb \
  && rm -f /tmp/onedesk.deb \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# The deb's Depends target desktop distros where mesa and ALSA are always
# present; a slim container needs the rest of the Chromium runtime spelled
# out. libgbm1 and libasound2 are the two the release binary actually trips
# over (verified by running this image) and both are absent from the deb's
# own Depends list; libxkbcommon0 is what electron dlopens next.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       xvfb \
       fonts-noto-cjk \
       fonts-noto-core \
       fonts-noto-color-emoji \
       libgbm1 \
       libasound2 \
       libxkbcommon0 \
  && rm -rf /var/lib/apt/lists/*

# The deb ships an in-app updater feed baked for the native install layout.
# In a container the release image IS the update channel: dropping
# app-update.yml is exactly how fork/PR builds disable the updater
# (see apps/shell/electron-builder.cjs — no file, no auto-update), instead of
# letting the app download and swap binaries under the package manager's feet.
RUN rm -f /opt/OneDesk/resources/app-update.yml

# chromium's setuid sandbox cannot work here (no setuid inside image layers),
# so the entrypoint passes --no-sandbox; running as a non-root user keeps the
# blast radius of that small. uid 1000 matches the first host user, which is
# who usually owns the mounted volumes.
RUN useradd -u 1000 -m onedesk \
  && mkdir -p /data /output \
  && chown onedesk:onedesk /data /output
USER onedesk

COPY --chmod=755 batch-convert /usr/local/bin/batch-convert

ENTRYPOINT ["/usr/local/bin/batch-convert"]
