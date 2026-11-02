# Local Arabic fonts

Official source: [Google Fonts](https://github.com/google/fonts), pinned to commit `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec`.

`sources.json` records the exact source URL, expected byte length, and SHA-256 of each font. The metadata files are unmodified copies from this same source revision.

| Local filename | Family | CSS weight | Expected bytes |
| --- | --- | --- | ---: |
| Amiri-Regular.ttf | Amiri | 400 | 431116 |
| Amiri-Bold.ttf | Amiri | 700 | 413480 |
| NotoSansArabic.ttf | Noto Sans Arabic | 100 900 | 844676 |

Noto Sans Arabic is a variable font, with a `wght` axis from 100 to 900 and a `wdth` axis from 62.5 to 100. Its downloaded filename is simplified from `NotoSansArabic[wdth,wght].ttf`; the font bytes and internal names are unchanged. Use normal width for the reading interface.

## Licenses and attribution

Both families are distributed under the **SIL Open Font License, Version 1.1**. The complete copyright notices and license texts are retained in:

- `Amiri-OFL.txt` — Copyright 2010–2022 The Amiri Project Authors.
- `NotoSansArabic-OFL.txt` — Copyright 2022 The Noto Project Authors.

The supplied license permits embedding and redistribution with these notices. Retain the license files when packaging fonts with the site or downloads.

Upstream projects identified by Google Fonts metadata:

- [Amiri](https://github.com/aliftype/amiri), version 1.002 in the pinned metadata.
- [Noto Arabic](https://github.com/notofonts/arabic), Noto Sans Arabic v2.012 in the pinned metadata.

## Self-hosting

Serve the three TTF files from this directory using relative `@font-face` URLs and `font-display: swap`. No Google Fonts CSS or runtime Google network calls are needed. Verify each font against `sources.json` after download and before deployment.
