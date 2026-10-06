# Contributing to PaperLens

Use Node 22 or newer and PowerShell 7 on Windows for the complete development test suite. The browser extension itself needs neither Node nor PowerShell; the optional Windows installer runs on the PowerShell included with Windows.

```powershell
npm ci
npm run typecheck
npm test
npm run package:share
```

For a reading/extraction bug, include the public page URL, PaperLens version, browser version, the expected passage or section, and the source-scope notice. Explain whether the missing text is visible in the loaded page. Prefer minimal constructed HTML fixtures over copying an entire copyrighted or private article.

Never include API keys, authenticated page captures, browser profile data or generated native-host registration files in an issue or contribution. Provider errors can be reported with credentials and private source text removed.

Keep original article nodes and passage order, exclude PaperLens UI from extraction, and render model output as untrusted text. Add regression tests for meaningful behavior changes. Reload the unpacked extension and article tab after changing content scripts.

Project code is licensed under MIT. Vendored libraries retain their own licenses and notices; see THIRD_PARTY_NOTICES.md.
