#!/usr/bin/env node
// Mirror a GitHub Release to AtomGit (api.atomgit.com, Gitee-style v5 API).
//
//   ATOMGIT_TOKEN=... node scripts/publish-atomgit.mjs --tag v0.13.0 \
//       [--owner futuremeng] [--repo OneDesk] [--body "..."] file [file...]
//
// Creates the release when the tag has none yet (tags already live on AtomGit
// via the `both` remote, so CI never needs to cut one), then PUTs every file
// through the documented upload_url handshake:
//   GET  /repos/{owner}/{repo}/releases/tags/{tag}          -> find existing
//   POST /repos/{owner}/{repo}/releases?access_token=...    -> create
//   GET  /repos/{owner}/{repo}/releases/{tag}/upload_url?file_name=... -> {url, headers}
//   PUT  {url} with those headers                           -> attach asset
// Re-running is a no-op for files already attached under the same name.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const API = 'https://api.atomgit.com/api/v5';

function die(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
let tag = null;
let owner = process.env.ATOMGIT_OWNER || 'futuremeng';
// Commit used only when the API must cut the tag on AtomGit (tags are not
// pushed there; the release-creation endpoint creates a missing tag from this
// commit, defaulting to the repo's HEAD without it).
let commitish = process.env.ATOMGIT_COMMITISH || '';
// Default the repo to this repository's name: the AtomGit fork is a same-name
// clone pushed by the `both` remote.
let repo = process.env.ATOMGIT_REPO || (process.env.GITHUB_REPOSITORY || '').split('/')[1] || null;
let name = null;
let body = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--tag') tag = argv[++i];
  else if (a === '--commitish') commitish = argv[++i];
  else if (a === '--owner') owner = argv[++i];
  else if (a === '--repo') repo = argv[++i];
  else if (a === '--name') name = argv[++i];
  else if (a === '--body') body = argv[++i];
  else if (a.startsWith('--')) die(`unknown flag ${a}`);
  else files.push(a);
}
if (!tag) die('usage: publish-atomgit.mjs --tag vX.Y.Z [--owner o] [--repo r] [--body text] file...');
if (!repo) die('repo unknown: pass --repo or set GITHUB_REPOSITORY/ATOMGIT_REPO');
if (files.length === 0) die('no files to upload');
for (const f of files) if (!fs.existsSync(f) || !fs.statSync(f).isFile()) die(`not a file: ${f}`);

const token = process.env.ATOMGIT_TOKEN;
if (!token) {
  die('ATOMGIT_TOKEN is not set — create a private token at atomgit.com (个人设置 → 私人令牌) and export it');
}

async function api(pathname, { method = 'GET', headers = {}, body: reqBody } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { Accept: 'application/json', ...headers },
    body: reqBody,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, json, text };
}

// A release mirrors the GitHub tag's prerelease state: anything with a suffix
// (v1.0.0-rc1) is "pre", plain versions are "latest".
const releaseStatus = tag.includes('-') ? 'pre' : 'latest';

// 1. Find or create the release.
const found = await api(`/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
let release;
if (found.status === 200 && found.json?.tag_name) {
  release = found.json;
  console.log(`AtomGit release for ${tag} already exists (${(release.assets || []).length} assets)`);
} else if (found.status === 404) {
  const created = await api(
    `/repos/${owner}/${repo}/releases?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: name || tag,
        // the v5 endpoint rejects an empty body — fall back to the release name
        body: body || name || tag,
        release_status: releaseStatus,
        ...(commitish ? { target_commitish: commitish } : {}),
      }),
    },
  );
  if (created.status !== 200 || !created.json?.tag_name) {
    die(`create release failed: HTTP ${created.status} ${created.text.slice(0, 500)}`);
  }
  release = created.json;
  console.log(`Created AtomGit release ${tag}`);
} else {
  die(`release lookup failed: HTTP ${found.status} ${found.text.slice(0, 500)}`);
}

// 2. Attach every file that is not already on the release under its name.
const attached = new Set((release.assets || []).map((a) => a.name));
for (const file of files) {
  const fileName = path.basename(file);
  if (attached.has(fileName)) {
    console.log(`skip ${fileName} (already attached)`);
    continue;
  }
  const up = await api(
    `/repos/${owner}/${repo}/releases/${encodeURIComponent(tag)}/upload_url` +
      `?access_token=${encodeURIComponent(token)}&file_name=${encodeURIComponent(fileName)}`,
  );
  if (up.status !== 200 || !up.json?.url) {
    die(`upload_url for ${fileName} failed: HTTP ${up.status} ${up.text.slice(0, 500)}`);
  }
  const { url, headers } = up.json;
  const size = fs.statSync(file).size;
  const put = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Length': String(size) },
    body: Readable.toWeb(fs.createReadStream(file)),
    duplex: 'half',
  });
  if (!put.ok) {
    die(`upload of ${fileName} failed: HTTP ${put.status} ${(await put.text()).slice(0, 500)}`);
  }
  console.log(`uploaded ${fileName} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

console.log(`AtomGit release ready: https://atomgit.com/${owner}/${repo}/releases`);
