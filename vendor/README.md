# vendor/

Place the Ableton Extensions SDK tarballs here (download them from Centercode):

- `ableton-extensions-sdk-1.0.0-beta.0.tgz`
- `ableton-extensions-cli-1.0.0-beta.0.tgz`

The SDK is a private Ableton beta and is **not** redistributed in this repo — `vendor/*.tgz` is gitignored. `package.json` references these tarballs via `file:vendor/...`. After placing them, run `npm install`. See the root `README.md` for full setup.
