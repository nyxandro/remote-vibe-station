/**
 * @fileoverview Docker image cleanup for runtime self-updates.
 *
 * Exports:
 * - RuntimeImageCleanupInput - Dependencies for pruning old runtime image tags.
 * - pruneOldRuntimeImages - Removes stale RVS image tags while preserving current target and rollback tags.
 */

const RVS_IMAGE_REPOSITORIES = [
  "ghcr.io/nyxandro/remote-vibe-station-backend",
  "ghcr.io/nyxandro/remote-vibe-station-miniapp",
  "ghcr.io/nyxandro/remote-vibe-station-bot",
  "ghcr.io/nyxandro/remote-vibe-station-opencode"
];

const RVS_IMAGE_ENV_KEYS = ["RVS_BACKEND_IMAGE", "RVS_MINIAPP_IMAGE", "RVS_BOT_IMAGE", "RVS_OPENCODE_IMAGE"];

export type RuntimeImageCleanupInput = {
  runtimeDir: string;
  envSnapshots: Array<Record<string, string>>;
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
};

export async function pruneOldRuntimeImages(input: RuntimeImageCleanupInput): Promise<void> {
  /* Cleanup touches only RVS image tags; Docker volumes, data, Traefik and cliproxy images are left intact. */
  const keepImages = collectKeepImages(input.envSnapshots);
  const script = buildPruneScript(keepImages);
  await input.runCommand("sh", ["-lc", script], input.runtimeDir);
}

function collectKeepImages(envSnapshots: Array<Record<string, string>>): string[] {
  /* Preserve target images and the previous .env images so rollback stays available after cleanup. */
  const keep = new Set<string>();
  for (const env of envSnapshots) {
    for (const key of RVS_IMAGE_ENV_KEYS) {
      const image = env[key]?.trim();
      if (image && isRvsImage(image)) {
        keep.add(image);
      }
    }
  }
  return [...keep].sort();
}

function buildPruneScript(keepImages: string[]): string {
  /* Shell keeps the cleanup dependency-free inside the backend container that already has Docker CLI. */
  const keepCase = keepImages.length > 0
    ? keepImages.map(shellQuote).join("|")
    : "__never_match_runtime_image__";
  const repositoryCase = RVS_IMAGE_REPOSITORIES.map((repository) => `${repository}:*`).join("|");
  return [
    "set -eu",
    "docker images --format '{{.Repository}}:{{.Tag}}' | while IFS= read -r image; do",
    `  case "$image" in ${repositoryCase}) ;; *) continue ;; esac`,
    `  case "$image" in ${keepCase}) continue ;; esac`,
    "  error_file=$(mktemp)",
    "  if docker image rm \"$image\" >/dev/null 2>\"$error_file\"; then rm -f \"$error_file\"; continue; fi",
    "  error=$(cat \"$error_file\")",
    "  rm -f \"$error_file\"",
    "  case \"$error\" in *'image is being used'*|*'conflict: unable to delete'*) continue ;; esac",
    "  printf 'APP_RUNTIME_IMAGE_CLEANUP_FAILED: failed to remove %s: %s\\n' \"$image\" \"$error\" >&2",
    "  exit 1",
    "done"
  ].join("\n");
}

function isRvsImage(image: string): boolean {
  /* Only exact RVS repositories are managed; unrelated operator images must never be pruned here. */
  return RVS_IMAGE_REPOSITORIES.some((repository) => image.startsWith(`${repository}:`));
}

function shellQuote(value: string): string {
  /* Image refs are generated internally, but quote defensively before embedding into sh -lc script. */
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
