import { createGitHubService, type ForgeService } from "./github-service.js";

/**
 * Resolves the forge service to use for a workspace.
 *
 * Every repository is currently treated as GitHub, so this returns the GitHub
 * adapter. This is the single seam where per-forge selection (GitHub, GitLab,
 * and future forges) will be added; see
 * https://github.com/getpaseo/paseo/issues/1616.
 */
export function resolveForgeService(): ForgeService {
  return createGitHubService();
}
