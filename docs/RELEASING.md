# Maintaining public PaperLens releases

The public repository is [gmbcofficial2024/paperlens](https://github.com/gmbcofficial2024/paperlens). End users install browser assets from [GitHub Releases](https://github.com/gmbcofficial2024/paperlens/releases/latest). They do not need Git, Node or a GitHub token to download public releases. GitHub's automatically generated **Source code** archives are development source, not the ready extension package.

## Prepare a version

Use Node 24 LTS for maintenance, matching CI. Update the version in `manifest.json`, `package.json`, `package-lock.json`'s top-level `version` and `package-lock.json`'s `packages[""].version` together. Changes on `main` and pull requests run typechecking, the regression suite and packaging on Windows so the native-host and install/update tests use their intended platform.

Run the same checks locally before tagging:

```powershell
npm ci
npm run typecheck
npm test
node scripts/package-share.mjs --release-tag v1.1.4
```

Replace `v1.1.4` with the version being released. The packaging command rejects differences among the four version fields above or a tag that is not exactly `v<manifest.version>`.

`package:share` always invokes the distribution build (`build.mjs --distribution`), which fixes only Google Gemini API requests to `gemini-flash-latest`. Other provider/model choices and optional Codex/Claude native summaries remain available. Only the stored Gemini model fields are normalized, and the final request boundary clamps Gemini requests without changing another provider's model or credentials. Ordinary `npm run build` remains the development build with Gemini model selection as well. Publish the packaged output, not development `dist/` bundles.

The command produces:

- `release/paperlens-<version>.zip`: the 18-file browser package, including the project's MIT LICENSE and third-party licenses/notices.
- `release/paperlens-<version>/`: the same browser files unpacked.
- `release/Install-Update-PaperLens.cmd` and `release/install-update-paperlens.ps1`: the Windows install/update helpers, copied from their reviewed source files.
- `release/SHA256SUMS`: SHA-256 lines for the ZIP and both helpers in the format `<hash>  <filename>`.

The ZIP excludes native registration manifests, workstation paths, extension IDs, credentials, source files and Node dependencies. Installation helpers stay beside the ZIP rather than inside the browser extension directory. Keep all three asset hashes in `SHA256SUMS` aligned with the files actually uploaded; rerun packaging after changing a helper or browser file.

## Publish a checked tag

After the prepared changes are committed to the public repository's `main`, create and push an annotated tag for that same version:

```powershell
git tag -a v1.1.4 -m "PaperLens 1.1.4"
git push origin v1.1.4
```

Tagging is the release trigger. The Release workflow checks all four version fields and their agreement with the tag, installs locked dependencies, runs typechecking and all tests, creates the assets, then publishes a GitHub Release containing the ZIP, `SHA256SUMS` and both helpers. The release body includes the user installation guide in `docs/RELEASE_NOTES.md` followed by generated changes. It uses the workflow's `GITHUB_TOKEN`; no maintainer token belongs in source or user downloads. The workflow publishes only from `gmbcofficial2024/paperlens`.

Review the Actions result and uploaded asset list before announcing the version. Actions are pinned to official release commit SHAs; update those pins deliberately when adopting a new Actions version. If a checked build or packaging step fails, no release is created. If a publish attempt partially creates a release, inspect its assets before manually completing or removing that draft/release; blindly rerunning an existing release creation can fail because the tag's release already exists.

Use a new version for corrected public assets instead of silently replacing an announced build. For rollback, publish the corrected code as a newer version so the latest-release updater can find it.

## What users do

The Windows launcher requires both `Install-Update-PaperLens.cmd` and `install-update-paperlens.ps1` in the same local directory. It downloads the latest public release ZIP and `SHA256SUMS`, checks the ZIP checksum and allowed contents, and installs or updates a permanent extension directory. See [installation instructions](INSTALL.md).

For a new Windows installation without a specified target, the helper and agent runbook resolve the user's actual Documents Known Folder (`MyDocuments`) and append `PaperLens\extension`, independent of the working directory. This follows supported local Documents redirection, including OneDrive. An explicit installation target takes precedence. Load that permanent directory once through Chrome's **Load unpacked**, and save the user's own API key. Existing users should update the directory already loaded in Chrome, even if an older install used LocalAppData. Replacing that directory's browser files and reloading the same extension keeps its browser profile and local settings together. Loading a different versioned directory can create a separate extension identity; uninstalling the extension removes its local storage.

After copying an update, users still click PaperLens's **Reload** control at `chrome://extensions` and refresh article tabs. GitHub Releases provides downloads; Chrome does not automatically install new files from these releases into an unpacked extension. Native Codex/Claude integration remains optional and separately installed from source.

The Windows helper has a `-LocalReleaseDirectory` fixture mode for offline tests. Use fixtures for updater regression checks rather than changing public releases or contacting model APIs during tests.
