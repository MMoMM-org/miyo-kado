# syntax=docker/dockerfile:1.4

########################################
# 1. Base stage
# CC-BLOCK:BASE-START
########################################
FROM node:20-slim AS base

ARG CONFIG_VERSION=1.0
ARG BUILD_DATE

LABEL configVersion="${CONFIG_VERSION}" \
      buildDate="${BUILD_DATE}"

# C.UTF-8 is a built-in glibc locale — no locale-gen needed
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    bash curl wget git jq \
    openssh-client ca-certificates \
    build-essential \
    python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

# Common tools available in all variants
RUN --mount=type=cache,target=/root/.npm \
    npm install -g \
      @grekt/cli \
      typescript-language-server \
      typescript \
      @biomejs/biome \
      prettier

RUN useradd -m -u 1001 -s /bin/bash coder \
 && mkdir -p /repo /home/coder/.local/bin \
 && chown -R coder:coder /repo /home/coder

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /repo
# CC-BLOCK:BASE-END

########################################
# 2. General variant
# CC-BLOCK:GENERAL-START
########################################
FROM base AS general

ARG CONFIG_VARIANT=general

LABEL config="${CONFIG_VARIANT}" \
      imageName="claude-code-${CONFIG_VARIANT}"

ENV DISABLE_INSTALLATION_CHECKS=1

RUN --mount=type=cache,target=/root/.npm \
    npm install -g @anthropic-ai/claude-code bun

ENV CLAUDE_CODE_NEW_INIT=true

USER coder
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# CC-BLOCK:GENERAL-END

########################################
# 3. Secure variant
# CC-BLOCK:SECURE-START
########################################
FROM base AS secure

ARG CONFIG_VARIANT=secure

LABEL config="${CONFIG_VARIANT}" \
      imageName="claude-code-${CONFIG_VARIANT}"

# Secure-only packages
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    python3-venv pipx \
    clamav clamav-freshclam \
    procps findutils cron bc \
 && rm -rf /var/lib/apt/lists/*

ENV DISABLE_INSTALLATION_CHECKS=1

RUN --mount=type=cache,target=/root/.npm \
    npm install -g @socketsecurity/cli @anthropic-ai/claude-code bun \
 && npm config set ignore-scripts true

RUN pipx install pip-audit

RUN sed -i 's/^#\?Foreground.*/Foreground yes/' /etc/clamav/freshclam.conf || true \
 && freshclam --quiet || echo "[INFO] freshclam initial update skipped (offline)"

COPY secure/scripts/ /usr/local/bin/claude-scripts/
RUN chmod +x /usr/local/bin/claude-scripts/*.sh

ENV PATH="/home/coder/.local/bin:$PATH"
ENV CLAUDE_CODE_NEW_INIT=true

USER coder
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# CC-BLOCK:SECURE-END
