# syntax=docker/dockerfile:1.4

########################################
# 1. Base stage
# CC-BLOCK:BASE-START
########################################
FROM node:22-slim AS base

ARG CONFIG_VERSION=1.0
ARG BUILD_DATE

LABEL configVersion="${CONFIG_VERSION}" \
      buildDate="${BUILD_DATE}"

# Bootstrap: ca-certificates + curl needed before adding GitHub CLI apt repo
# Then add GH CLI repo and install all packages in one apt-get pass
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl wget \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
    locales \
    bash git jq \
    openssh-client \
    build-essential \
    python3 python3-pip \
    zsh fzf ripgrep fd-find \
    tree htop tmux man-db \
    gh \
 && (sed -i -e 's/# de_DE.UTF-8 UTF-8/de_DE.UTF-8 UTF-8/' /etc/locale.gen || true) \
 && (grep -q "^de_DE.UTF-8" /etc/locale.gen || echo "de_DE.UTF-8 UTF-8" >> /etc/locale.gen) \
 && locale-gen \
 && rm -rf /var/lib/apt/lists/*

ENV LANG=de_DE.UTF-8 \
    LANGUAGE=de_DE:de \
    LC_ALL=de_DE.UTF-8

# yq — YAML processor (not in standard apt)
ARG YQ_VERSION=4.44.1
RUN ARCH=$(dpkg --print-architecture) && \
    wget -qO /usr/local/bin/yq \
      "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${ARCH}" && \
    chmod +x /usr/local/bin/yq

# git-delta — better git diffs
ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
    wget -q "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Common tools available in all variants
RUN --mount=type=cache,target=/root/.npm \
    npm install -g \
      @grekt/cli \
      @vtsls/language-server \
      typescript \
      @biomejs/biome \
      prettier

RUN useradd -m -u 1001 -s /bin/zsh coder \
 && mkdir -p /repo /home/coder/.local/bin \
 && chown -R coder:coder /repo /home/coder

# zsh setup — runs as coder to write ~/.zshrc, ~/.oh-my-zsh
ARG ZSH_IN_DOCKER_VERSION=1.2.0
USER coder
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
    -p git \
    -p fzf \
    -a "[ -f /usr/share/doc/fzf/examples/key-bindings.zsh ] && source /usr/share/doc/fzf/examples/key-bindings.zsh" \
    -a "[ -f /usr/share/doc/fzf/examples/completion.zsh ] && source /usr/share/doc/fzf/examples/completion.zsh" \
    -a "alias fd=fdfind" \
    -a "alias rg='rg --smart-case'"
USER root

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

# Secure-only packages (+ iptables/ipset for Phase 5 firewall)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    python3-venv pipx \
    clamav clamav-freshclam \
    procps findutils cron bc \
    iptables ipset iproute2 aggregate \
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
