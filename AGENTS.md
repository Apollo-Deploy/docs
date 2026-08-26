> For Mintlify product knowledge (components, configuration, writing standards),
> install the Mintlify skill: `npx skills add https://mintlify.com/docs`

# Apollo Deploy documentation

## About this project

- Mintlify documentation site for Apollo Deploy and Apollo Signal
- Pages are MDX files with YAML frontmatter, organized by product:
  - `deploy/` — Apollo Deploy docs
  - `signal/` — Apollo Signal docs
- Top-level **product tabs** in the sidebar are configured via `navigation.products` in `docs.json`
- Apollo Signal uses three top-level tabs: **Documentation**, **API Reference**, and **Knowledge base**
- Product documentation and Knowledge Base articles are authored directly as MDX under `deploy/` and `signal/`
- `scripts/generate-signal-api-reference.mjs` is reserved for the mechanical Apollo Signal API-reference artifact

## Editing content

- Treat each MDX file as the source of truth for its page
- Edit the file referenced by `docs.json`; do not create JavaScript content generators for guides or Knowledge Base articles
- Keep API-reference generation separate from hand-authored product documentation

## Terminology

- **Apollo Deploy** — Release intelligence control plane (mobile + backend rollouts)
- **Apollo Signal** — Transactional email API and deliverability platform
- Use "project" for Signal workspaces, "rollout" for Deploy release stages
- Prefer "Get started" over "Start free trial" (no free trial on paid plans)

## Style preferences

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references
- Match the direct, technical tone of the marketing site — no hype, no filler

## Content boundaries

- Document public product APIs and user-facing configuration only
- Link to the marketing site for product overviews and pricing comparisons
- Do not document internal admin or unreleased features

## URLs (production)

| Destination | URL |
|-------------|-----|
| Marketing | `https://apollodeploy.com` |
| Docs | `https://docs.apollodeploy.com` |
| Auth | `https://auth.apollodeploy.com` |
| Dashboard | `https://app.apollodeploy.com` |
| Signal | `https://signal.apollodeploy.com` |
| Signal API | `https://api.signal.apollodeploy.com` |
