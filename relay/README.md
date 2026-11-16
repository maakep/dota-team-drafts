# Draft saving relay

This Cloudflare Worker dispatches `save-draft.yml` on `main` in `maakep/dota-team-drafts`. It keeps the GitHub credential in a Worker secret. The Pages site receives only the Worker URL.

Deployed address: https://dota-draft-relay.maakep.workers.dev

## Deploy

Use Node.js 22 or newer. From this directory:

```sh
npm ci
npm run login
npm run check
npm run deploy
```

Stay on **Workers Free**. No database, storage service, custom domain or paid add-on is required. The free request quota stops serving requests when exhausted; it does not create request overage charges. See [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/).

After deployment, create a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new) owned by `maakep`, with access to **only** `dota-team-drafts` and repository permission **Actions: Read and write**. Set an expiration and renew it before it expires. Contents write access is not needed; the save workflow commits with its own `GITHUB_TOKEN`.

In the Cloudflare dashboard, open **Workers & Pages → dota-draft-relay → Settings → Variables and Secrets → Add**. Select **Secret**, name it **GITHUB_ACTIONS_TOKEN**, paste the token and deploy the change. Alternatively, run `npx wrangler secret put GITHUB_ACTIONS_TOKEN` here and enter it at the hidden prompt. Keep the token out of source files, GitHub Pages and chat.

`GET https://<worker-address>/health` reports `{"ok":true,"configured":true}` once its bindings and secret are present. This checks configuration, not whether GitHub accepts the token.

Set `publishEndpoint` in the root `data/config.json` to the deployed HTTPS Worker address, then commit and push. Pages rebuilds automatically. Test **Save to GitHub** and confirm the save workflow and subsequent Pages deployment succeed.

## Boundaries

Draft submissions are public by design: app users need no login. The Worker validates against the same hero catalog and draft rules as the repository, caps input size, strips unknown fields, and accepts only draft content and its previous fingerprint. Repository, workflow and branch cannot be supplied by callers. The workflow validates again and rejects conflicting updates.

The bindings allow 10 save attempts and 120 status checks per minute per IP, per Cloudflare location. These limits are approximate and do not form a global quota. The allowed-origin header restricts other websites in browsers; it is not authentication and can be imitated by scripts. These controls reduce casual abuse without claiming to eliminate it. See [Cloudflare rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Only save workflow runs can be checked through the status route. Errors never include upstream response bodies or credentials. Secrets survive normal redeploys. Hero catalog and validation changes take effect in this Worker after another `npm run deploy`.

For local testing, use `npm run dev`; an optional `.dev.vars` file is ignored by Git. Root `npm test` covers the relay without a Cloudflare account or token. `npm run check` verifies Wrangler can bundle the Worker without deploying it.
