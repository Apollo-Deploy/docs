# Apollo Deploy Documentation

Documentation site for [Apollo Deploy](https://apollodeploy.com) and [Apollo Signal](https://apollodeploy.com/signal), built with [Mintlify](https://mintlify.com).

The site uses Mintlify's Luma theme with Apollo branding, Geist typography, and a system-aware appearance.

## Development

Mintlify requires **Node.js 20–24** (LTS). It does not support Node 25+.

### Quick start

From this directory (`apps/docs`):

```bash
npm install
npm run dev
```

The `dev` script automatically uses Homebrew `node@24` when your default Node is 25+.

Preview at `http://localhost:3000`.

### Node version

This repo pins Node 24 in `.nvmrc` / `.node-version`. If you use a version manager:

```bash
# fnm
fnm use

# nvm
nvm use

# Homebrew (macOS) — if Node 25 is your default
brew install node@24
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
npm run dev
```

### Global CLI (optional)

```bash
npm i -g mint
mint dev
```

Use Node 24 when running `mint` globally as well.

## Customization

| File | Purpose |
|------|---------|
| `docs.json` | Site name, theme, colors, product tabs, and navbar |
| `logo/` | Apollo mark for light and dark mode |
| `deploy/`, `signal/` | Directly authored documentation and Knowledge Base pages (MDX) |
| `scripts/generate-signal-api-reference.mjs` | Builds the public API reference from Signal OpenAPI and Tesseract metadata |

### Editing Apollo Signal documentation

Documentation and Knowledge Base articles are ordinary MDX files under `signal/`. Edit those files directly and update `docs.json` when adding, moving, or removing a page. There is no content-generation step for these pages.

### Regenerating the Apollo Signal API reference

The checked reference contains only routes that are public in Signal's Tesseract manifest. Internal health, billing, event-ingestion, tracking, migration, project-deletion, dedicated-IP, DMARC, and session-only management routes are deliberately excluded.

First export fresh OpenAPI and Tesseract artifacts from the Signal API checkout:

```bash
cd ../../../APIs/apollo-signal-api

APP_ENV=test \
PLATFORM_URL=http://localhost:3000 \
PLATFORM_CLIENT_ID=build \
PLATFORM_CLIENT_SECRET=build \
OAUTH_SERVICE_CLIENT_IDS=build \
SESSION_SECRET=build \
INTERNAL_SERVICE_SECRET=build \
APOLLO_SIGNAL_AWS_REGION=us-east-1 \
OPENAPI_ARTIFACT_PATH=build/docs-openapi.json \
TESSERACT_GENERATE=1 \
TESSERACT_MANIFEST_PATH=build/docs-manifest.json \
./gradlew run -q
```

Then generate and verify the checked public artifact:

```bash
cd ../../Website/apps/docs
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run generate:signal-api -- \
  --openapi ../../../APIs/apollo-signal-api/build/docs-openapi.json
PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run check:signal-api -- \
  --openapi ../../../APIs/apollo-signal-api/build/docs-openapi.json
```

The generator verifies that every public manifest route exists in OpenAPI and in `docs.json`, that every endpoint documents permissions and applicable limits, and that no internal route enters the published artifact.

Finally, run `npm run dev` and switch to the **Apollo Signal** product's **API Reference** tab.

## Publishing

Changes deploy automatically when pushed to the default branch, via the Mintlify GitHub app.

## Resources

- [Mintlify documentation](https://mintlify.com/docs)
- [Apollo marketing site](https://apollodeploy.com)
