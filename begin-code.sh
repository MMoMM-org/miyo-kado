#!/bin/bash
# ============================================================
# begin-code.sh — Starts Claude Code in Docker
# Master copy: ~/Kouzou/scripts/begin-code.sh
# Deployed to: <repo>/begin-code.sh by claude-docker-install.sh
#
# Usage: ./begin-code.sh [OPTIONS]
#   --bash          Start bash shell instead of Claude Code
#   --yolo          Pass --dangerously-skip-permissions to Claude
#   --login         Force re-authentication (expose port 10000)
#   --volume PATH   Add extra volume mount (can repeat)
#   --help          Show this help
#   --version       Show script version
# ============================================================

set -e

SCRIPT_VERSION="1.0"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

print_info()    { echo -e "  ${CYAN}▶${NC} $1"; }
print_success() { echo -e "  ${GREEN}✓${NC} $1"; }
print_warning() { echo -e "  ${YELLOW}⚠${NC} $1"; }
print_error()   { echo -e "  ${RED}✗${NC} $1"; }

# ── Help / version ───────────────────────────────────────────
show_help() {
    cat << EOF

${BOLD}begin-code.sh${NC} — Start Claude Code in Docker
Version: $SCRIPT_VERSION

Usage: ./begin-code.sh [OPTIONS]

Options:
  --bash          Start bash shell instead of Claude Code
  --yolo          Pass --dangerously-skip-permissions to Claude
  --login         Force OAuth re-authentication (exposes port 10000)
  --rebuild       Force rebuild of the Docker image
  --volume PATH   Add extra volume mount (can repeat)
  --help          Show this help
  --version       Show script version

Examples:
  ./begin-code.sh                   # Start Claude Code
  ./begin-code.sh --bash            # Start bash shell
  ./begin-code.sh --yolo            # Skip permission prompts
  ./begin-code.sh --login           # Force re-auth
  ./begin-code.sh --rebuild         # Force image rebuild
  ./begin-code.sh --volume ~/data   # Mount extra volume

EOF
    exit 0
}

show_version() {
    echo "$SCRIPT_VERSION"
    exit 0
}

# ── Argument parsing ─────────────────────────────────────────
CLAUDE_MODE="claude"
YOLO="false"
FORCE_LOGIN=false
FORCE_REBUILD=false
EXTRA_VOLUMES=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --bash)    CLAUDE_MODE="bash"; shift ;;
        --yolo)    YOLO="true"; shift ;;
        --login)   FORCE_LOGIN=true; shift ;;
        --rebuild) FORCE_REBUILD=true; shift ;;
        --volume)  EXTRA_VOLUMES+=("$2"); shift 2 ;;
        --help|-h) show_help ;;
        --version) show_version ;;
        *)
            print_error "Unknown option: $1"
            echo "Run ./begin-code.sh --help for usage."
            exit 1
            ;;
    esac
done

# ── Determine REPO_DIR ───────────────────────────────────────
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Derive repo name ─────────────────────────────────────────
REPO_NAME="$(basename "$REPO_DIR")"
REPO_NAME_LOWER="$(echo "$REPO_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"

# ── Load repo config ─────────────────────────────────────────
REPO_CONFIG="$REPO_DIR/claude-docker/claude-docker-${REPO_NAME_LOWER}.json"
if [[ ! -f "$REPO_CONFIG" ]]; then
    print_error "Repo config not found: claude-docker/claude-docker-${REPO_NAME_LOWER}.json"
    echo "Run: ~/Kouzou/scripts/claude-docker-install.sh to set up Docker for this repo."
    exit 1
fi

CONFIG_VARIANT="$(jq -r '.config // "secure"' "$REPO_CONFIG")"
IMAGE_NAME="$(jq -r '.imageName // "claude-code-secure"' "$REPO_CONFIG")"
CONTAINER_NAME="$(jq -r '.containerName // "claude-'"$REPO_NAME_LOWER"'"' "$REPO_CONFIG")"
INSTALLED_VERSION="$(jq -r '.configVersion // "1.0"' "$REPO_CONFIG")"

# ── Banner ───────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}════════════════════════════════════════════${NC}"
echo -e "${CYAN}${BOLD}  Claude Code — ${REPO_NAME} (${CONFIG_VARIANT})${NC}"
echo -e "${CYAN}${BOLD}════════════════════════════════════════════${NC}"
echo ""

# ── Check Docker ─────────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start OrbStack or Docker Desktop."
    exit 1
fi
print_success "Docker available"

# ── Version check ─────────────────────────────────────────────
TEMPLATE_VERSION_FILE="$HOME/Kouzou/../claude-docker-template/claude-docker-template.json"
# Resolve via symlink target
KOUZOU_TARGET="$(readlink "$HOME/Kouzou" 2>/dev/null || echo "$HOME/Kouzou")"
TEMPLATE_VERSION_FILE="$KOUZOU_TARGET/../claude-docker-template/claude-docker-template.json"

if [[ -f "$TEMPLATE_VERSION_FILE" ]]; then
    CURRENT_VERSION="$(jq -r '.configVersion // "unknown"' "$TEMPLATE_VERSION_FILE" 2>/dev/null || echo "unknown")"
    if [[ "$INSTALLED_VERSION" != "$CURRENT_VERSION" && "$CURRENT_VERSION" != "unknown" ]]; then
        print_warning "Config version mismatch: installed=$INSTALLED_VERSION, current=$CURRENT_VERSION"
        echo "    Run ~/Kouzou/scripts/claude-docker-install.sh --update to update."
        echo ""
    fi
fi

# ── Resolve image / build if missing ─────────────────────────
if ! docker image inspect "${IMAGE_NAME}:${INSTALLED_VERSION}" > /dev/null 2>&1; then
    if ! docker image inspect "$IMAGE_NAME" > /dev/null 2>&1; then
        print_info "Image not found — building from repo template..."
        BUILD_CONTEXT="$REPO_DIR/claude-docker"
        if [[ ! -f "$BUILD_CONTEXT/Dockerfile" ]]; then
            print_error "Dockerfile not found: $BUILD_CONTEXT/Dockerfile"
            echo "Run claude-docker-install.sh to install the template into this repo."
            exit 1
        fi
        DOCKER_BUILDKIT=1 docker build \
            --build-arg CONFIG_VARIANT="$CONFIG_VARIANT" \
            --build-arg CONFIG_VERSION="$INSTALLED_VERSION" \
            --build-arg BUILD_DATE="$(date +%Y-%m-%d)" \
            -t "${IMAGE_NAME}:${INSTALLED_VERSION}" \
            -t "$IMAGE_NAME" \
            --target "$CONFIG_VARIANT" \
            -f "$BUILD_CONTEXT/Dockerfile" \
            "$BUILD_CONTEXT"
        print_success "Image built: ${IMAGE_NAME}:${INSTALLED_VERSION}"
    fi
else
    print_success "Image: ${IMAGE_NAME}:${INSTALLED_VERSION}"
fi

# ── Image age check ───────────────────────────────────────────
IMAGE_CREATED="$(docker image inspect --format '{{.Created}}' "${IMAGE_NAME}:${INSTALLED_VERSION}" 2>/dev/null | cut -c1-19 || echo "")"
if [[ -n "$IMAGE_CREATED" ]]; then
    IMAGE_EPOCH="$(date -j -f "%Y-%m-%dT%H:%M:%S" "$IMAGE_CREATED" "+%s" 2>/dev/null || echo 0)"
    NOW_EPOCH="$(date +%s)"
    AGE_DAYS=$(( (NOW_EPOCH - IMAGE_EPOCH) / 86400 ))
    if [[ "$AGE_DAYS" -gt 5 ]]; then
        print_warning "Image is ${AGE_DAYS} days old — consider rebuilding: ./begin-code.sh --rebuild"
        echo ""
    fi
fi

# ── Force rebuild ─────────────────────────────────────────────
if [[ "$FORCE_REBUILD" == "true" ]]; then
    BUILD_CONTEXT="$REPO_DIR/claude-docker"
    if [[ ! -f "$BUILD_CONTEXT/Dockerfile" ]]; then
        print_error "Dockerfile not found: $BUILD_CONTEXT/Dockerfile"
        exit 1
    fi
    print_info "Rebuilding ${IMAGE_NAME}:${INSTALLED_VERSION} ..."
    DOCKER_BUILDKIT=1 docker build \
        --build-arg CONFIG_VARIANT="$CONFIG_VARIANT" \
        --build-arg CONFIG_VERSION="$INSTALLED_VERSION" \
        --build-arg BUILD_DATE="$(date +%Y-%m-%d)" \
        -t "${IMAGE_NAME}:${INSTALLED_VERSION}" \
        -t "$IMAGE_NAME" \
        --target "$CONFIG_VARIANT" \
        -f "$BUILD_CONTEXT/Dockerfile" \
        "$BUILD_CONTEXT"
    print_success "Image rebuilt: ${IMAGE_NAME}:${INSTALLED_VERSION}"
    echo ""
fi

# ── Stop existing container if running ───────────────────────
if docker ps -q -f "name=^${CONTAINER_NAME}$" 2>/dev/null | grep -q .; then
    docker stop "$CONTAINER_NAME" > /dev/null 2>&1 || true
fi
if docker ps -aq -f "name=^${CONTAINER_NAME}$" 2>/dev/null | grep -q .; then
    docker rm "$CONTAINER_NAME" > /dev/null 2>&1 || true
fi

# ── dev-notify-bridge lifecycle ───────────────────────────────
DNB_CONFIG="$HOME/Kouzou/claude-docker-config.json"
DNB_PORT="9999"
if [[ -f "$DNB_CONFIG" ]]; then
    DNB_PORT="$(jq -r '.devNotifyBridge.port // 9999' "$DNB_CONFIG")"
    INSTANCES="$(jq -r '.devNotifyBridge.instances // 0' "$DNB_CONFIG")"

    # Check if bridge is actually running
    DNB_RUNNING=false
    if screen -ls 2>/dev/null | grep -q "dev-notify-bridge"; then
        DNB_RUNNING=true
    fi

    if [[ "$INSTANCES" -eq 0 ]] || [[ "$DNB_RUNNING" == "false" ]]; then
        # Start dev-notify-bridge in detached screen session.
        # Prefer global install (instant start); fall back to npx (slow: downloads on demand).
        # Recommended: npm install -g dev-notify-bridge
        DNB_CMD=""
        if command -v dev-notify-bridge > /dev/null 2>&1; then
            DNB_CMD="dev-notify-bridge --port $DNB_PORT"
        elif command -v npx > /dev/null 2>&1; then
            DNB_CMD="npx --yes dev-notify-bridge --port $DNB_PORT"
            print_warning "dev-notify-bridge not installed globally — using npx (slow on first run)"
            echo "    Install with: npm install -g dev-notify-bridge"
        fi

        if [[ -n "$DNB_CMD" ]]; then
            screen -dmS dev-notify-bridge $DNB_CMD 2>/dev/null || true
            print_info "dev-notify-bridge started on port $DNB_PORT"
            # node-notifier (used by dev-notify-bridge) requires terminal-notifier on macOS
            if ! command -v terminal-notifier > /dev/null 2>&1; then
                print_warning "terminal-notifier not installed — notifications may not appear"
                echo "    Install with: brew install terminal-notifier"
            fi
        else
            print_warning "dev-notify-bridge not available — desktop notifications disabled"
            echo "    Install with: npm install -g dev-notify-bridge"
            echo "    Then also:    brew install terminal-notifier"
        fi
        INSTANCES=1
    else
        INSTANCES=$(( INSTANCES + 1 ))
    fi

    # Update instances counter (atomic via temp file — same dir avoids cross-fs mv warning)
    _DNB_TMP="$(dirname "$DNB_CONFIG")/.cdc-tmp-$$"
    jq ".devNotifyBridge.instances = $INSTANCES" "$DNB_CONFIG" > "$_DNB_TMP" \
        && mv "$_DNB_TMP" "$DNB_CONFIG"
fi

# ── Auth check ───────────────────────────────────────────────
CLAUDE_HOME="$REPO_DIR/claude-docker-home"
AUTH_FLAGS=""

if [[ "$FORCE_LOGIN" == "true" ]]; then
    AUTH_FLAGS="-p 10000:10000"
    print_warning "Login mode — port 10000 exposed for OAuth callback"
elif [[ ! -f "$CLAUDE_HOME/.claude/.credentials.json" ]]; then
    AUTH_FLAGS="-p 10000:10000"
    print_warning "No credentials found — port 10000 exposed for OAuth callback"
    echo ""
    echo "    Run the install script with --recreate-auth to set up credentials:"
    echo -e "      ${CYAN}~/Kouzou/scripts/claude-docker-install.sh --recreate-auth $REPO_DIR${NC}"
    echo ""
    if [[ -f "$CLAUDE_HOME/.claude.json" ]]; then
        print_warning "  .claude.json found but .credentials.json missing"
        echo "    Claude Code will start in API billing mode (not Pro subscription)."
        echo "    Run --recreate-auth to fix, or --login to authenticate via OAuth."
        echo ""
    fi
else
    print_success "Auth state found (.credentials.json)"
fi

# ── Load variant-specific docker flags ───────────────────────
CONFIG_SH="$REPO_DIR/claude-docker/$CONFIG_VARIANT/claude-docker-config.sh"
DOCKER_FLAGS=()
DOCKER_ENTRYPOINT_PREFIX=""
if [[ -f "$CONFIG_SH" ]]; then
    # shellcheck source=/dev/null
    source "$CONFIG_SH"
fi

# ── Optional env-file for API keys ───────────────────────────
ENV_FILE_FLAGS=()
ENV_FILE="$REPO_DIR/claude-docker/.env"
if [[ -f "$ENV_FILE" ]]; then
    ENV_FILE_FLAGS=("--env-file" "$ENV_FILE")
    print_info "API keys: loading from claude-docker/.env"
fi

# ── Build volume mounts ───────────────────────────────────────
# ccusage reads ~/.claude/projects/ for session data. Inside the container
# that resolves to claude-docker-home/.claude/projects/ — an isolated dir
# with no host session history. Fix: mount the full host projects dir ro,
# then overlay the project-specific subdir rw so Claude Code can write its
# own session data (Docker child mounts take precedence over parent mounts).
PROJECT_SUBDIR="$(echo "$REPO_DIR" | tr '/' '-')"
HOST_PROJECTS="${HOME}/.claude/projects"
HOST_PROJECT_SUBDIR="${HOST_PROJECTS}/${PROJECT_SUBDIR}"

# Ensure the project subdir exists on the host so the rw mount works
mkdir -p "$HOST_PROJECT_SUBDIR"

VOLUME_FLAGS=(
    "-v" "${REPO_DIR}:${REPO_DIR}"
    "-v" "${CLAUDE_HOME}:/home/coder"
    "-v" "${HOST_PROJECTS}:/home/coder/.claude/projects:ro"
    "-v" "${HOST_PROJECT_SUBDIR}:/home/coder/.claude/projects/${PROJECT_SUBDIR}"
)

# projectMount auto-detection
PROJECT_MOUNT="$(jq -r '.projectMount // "auto"' "$REPO_CONFIG")"
if [[ "$PROJECT_MOUNT" == "auto" ]]; then
    # Check if CLAUDE.md references ~/Kouzou/projects/
    if [[ -f "$REPO_DIR/CLAUDE.md" ]]; then
        PROJ_REFS="$(grep -o '~/Kouzou/projects/[^[:space:]"]*' "$REPO_DIR/CLAUDE.md" 2>/dev/null || true)"
        while IFS= read -r PROJ_REF; do
            [[ -z "$PROJ_REF" ]] && continue
            PROJ_PATH="${PROJ_REF/#\~/$HOME}"
            if [[ -d "$PROJ_PATH" ]]; then
                VOLUME_FLAGS+=("-v" "${PROJ_PATH}:${PROJ_PATH}")
                print_info "Auto-mounting project: $PROJ_PATH"
            fi
        done <<< "$PROJ_REFS"
    fi
elif [[ -n "$PROJECT_MOUNT" && "$PROJECT_MOUNT" != "null" ]]; then
    VOLUME_FLAGS+=("-v" "${PROJECT_MOUNT}:${PROJECT_MOUNT}")
fi

# Extra volumes from --volume flags
for VOL in "${EXTRA_VOLUMES[@]}"; do
    VOLUME_FLAGS+=("-v" "${VOL}:${VOL}")
done

# ── Print session info ────────────────────────────────────────
print_info "Repo:      $REPO_DIR"
print_info "Container: $CONTAINER_NAME"
print_info "Image:     ${IMAGE_NAME}:${INSTALLED_VERSION}"
print_info "Mode:      $CLAUDE_MODE"
echo ""

# ── iTerm2 tab title ──────────────────────────────────────────
printf '\033]1;%s\007' "$REPO_NAME"

# ── Trap for cleanup on exit ─────────────────────────────────
cleanup() {
    # Decrement dev-notify-bridge counter
    if [[ -f "$DNB_CONFIG" ]]; then
        CURR=$(jq -r '.devNotifyBridge.instances // 1' "$DNB_CONFIG")
        NEW=$(( CURR - 1 ))
        [[ "$NEW" -lt 0 ]] && NEW=0
        _DNB_TMP2="$(dirname "$DNB_CONFIG")/.cdc-tmp-$$"
        jq ".devNotifyBridge.instances = $NEW" "$DNB_CONFIG" > "$_DNB_TMP2" \
            && mv "$_DNB_TMP2" "$DNB_CONFIG"
        if [[ "$NEW" -eq 0 ]]; then
            screen -X -S dev-notify-bridge quit 2>/dev/null || true
        fi
    fi
    # Reset iTerm2 tab title
    printf '\033]1;\007'
    echo ""
    echo -e "${GREEN}✓ Session ended.${NC}"
}
trap cleanup EXIT

# ── Build entrypoint command ──────────────────────────────────
if [[ -n "$DOCKER_ENTRYPOINT_PREFIX" ]]; then
    ENTRYPOINT_CMD="${DOCKER_ENTRYPOINT_PREFIX} /usr/local/bin/entrypoint.sh"
    ENTRYPOINT_ARGS=(--entrypoint /bin/bash)
    RUN_CMD_ARGS=("-c" "${DOCKER_ENTRYPOINT_PREFIX} exec /usr/local/bin/entrypoint.sh")
else
    RUN_CMD_ARGS=()
    ENTRYPOINT_ARGS=()
fi

# ── Run container ─────────────────────────────────────────────
docker run -it \
    --name "$CONTAINER_NAME" \
    --rm \
    $AUTH_FLAGS \
    "${ENV_FILE_FLAGS[@]}" \
    "${DOCKER_FLAGS[@]}" \
    -e REPO_NAME="$REPO_NAME" \
    -e GIT_USER_NAME="$(git -C "$REPO_DIR" config user.name 2>/dev/null || echo "")" \
    -e GIT_USER_EMAIL="$(git -C "$REPO_DIR" config user.email 2>/dev/null || echo "")" \
    -e CLAUDE_MODE="$CLAUDE_MODE" \
    -e YOLO="$YOLO" \
    -e DEV_NOTIFY_PORT="$DNB_PORT" \
    -w "$REPO_DIR" \
    "${VOLUME_FLAGS[@]}" \
    "${IMAGE_NAME}:${INSTALLED_VERSION}" \
    "${RUN_CMD_ARGS[@]}"
