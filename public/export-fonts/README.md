# PDF export fonts

Unmodified Noto Sans Regular and Noto Naskh Arabic Regular from
[notofonts/noto-fonts](https://github.com/notofonts/noto-fonts/tree/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf),
revision `ffebf8c1ee449e544955a7e813c54f9b73848eac`.
The copyright notice and SIL Open Font License 1.1 are retained in `OFL.txt`.

SHA-256:

- NotoSans-Regular.ttf: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`
- NotoNaskhArabic-Regular.ttf: `2f4b88e6ee50fa82c617e2d1d4ba18281cb1c6cd71c3af3ec64970c23995db4b`

These fonts cover Latin, Greek, Cyrillic and Arabic/Persian text, not all Unicode
scripts or emoji. Unsupported glyphs fail explicitly instead of producing silent
replacement characters. A downstream versioned renderer can supply additional
licensed fonts. Fonts are bundled in `public` so web/standalone/worker containers
use the same files without downloading them at runtime or relying on host fonts.
