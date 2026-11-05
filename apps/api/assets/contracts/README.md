# Versioned test contract template

`service-test-v1.pdf` is the existing static two-page source template, authored by `scripts/contracts/build-template.py` (ReportLab). It is a test document, not approved commercial terms. The API loads its pinned SHA-256 from `template-manifest.json`, embeds Vietnamese user/organization/billing/plan fields using pdf-lib, and stores the final bytes. Acceptance and email copy those bytes; neither regenerates the document.

Fonts: Noto Sans Regular and Bold, from [notofonts/noto-fonts](https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans), downloaded 2026-11-05. The included `fonts/OFL.txt` is the upstream SIL Open Font License. The manifest pins the runtime font and PDF bytes. No remote fonts or Python are needed at runtime.

Regenerate only as a new version for changes to published terms. Do not replace old accepted PDFs or rewrite their hashes. Commercial rollout requires an approved template, supplier details and tax/payment terms.
