export function projectDisplayNameFromProjectId(projectId: string): string {
  const githubRemotePrefix = "remote:github.com/";
  if (projectId.startsWith(githubRemotePrefix)) {
    return projectId.slice(githubRemotePrefix.length) || projectId;
  }

  const segments = projectId.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || projectId;
}

export function projectIconPlaceholderLabelFromDisplayName(displayName: string): string {
  const trimmedDisplayName = displayName.trim();
  if (!trimmedDisplayName) {
    return "";
  }

  const segments = trimmedDisplayName.split("/").filter(Boolean);
  return segments[segments.length - 1] || trimmedDisplayName;
}

/**
 * The single letter a project tile falls back to when it has no icon.
 *
 * Every surface that draws a project tile has to agree on this. Taking the first character of the
 * raw display name instead puts the owner's initial on every `owner/repo` project, so three
 * projects under one owner read as the same letter — which is the one thing the tile is for.
 */
export function projectIconInitialFromDisplayName(displayName: string): string {
  return projectIconPlaceholderLabelFromDisplayName(displayName).charAt(0).toUpperCase() || "?";
}
