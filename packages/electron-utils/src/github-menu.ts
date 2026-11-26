/** the public open-source repository; also the target of every in-app star CTA */
export const GITHUB_REPO_URL = 'https://github.com/futuremeng/OneDesk'
/** the primary release channel — every tag builds installers attached to a GitHub Release */
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`
/**
 * The AtomGit mirror of the GitHub Releases, for downloads where GitHub is
 * hard to reach; scripts/publish-atomgit.mjs keeps it in step with every tag.
 */
export const ATOMGIT_RELEASES_URL = 'https://atomgit.com/futuremeng/OneDesk/releases'
