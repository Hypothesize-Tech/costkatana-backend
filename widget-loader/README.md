# CostKatana agent widget loader

A ~3.6 kB IIFE bundle a customer pastes into their site. It injects a
launcher button + iframe pointing at `app.costkatana.ai/embed/:deploymentId`.

## Embed snippet

```html
<script src="https://costkatana-media.s3.amazonaws.com/agent-platform/widget/widget.js"
        data-deployment-id="dep_xxxxxxxx"
        defer></script>
```

If you put CloudFront in front of the bucket later (e.g. `cdn.costkatana.ai`),
swap the URL — no other change needed.

Optional attributes:

| Attribute | Default | Notes |
|---|---|---|
| `data-app-base` | `https://app.costkatana.ai` | Override the iframe origin. Useful for dev / staging. |
| `data-position` | `bottom-right` | `bottom-right` or `bottom-left`. |
| `data-launcher-color` | `#06ec9e` | CostKatana primary by default. |
| `data-launcher-label` | `Chat` | Text shown next to the icon. |

## Build

```sh
bash widget-loader/build.sh
```

Outputs `dist/widget.js` (minified IIFE) + sourcemap.

## Deploy (re-uses the existing `costkatana-media` S3 bucket)

```sh
bash widget-loader/deploy.sh
```

Reads `AWS_S3_BUCKET` (default `costkatana-media`) and `AWS_REGION` from
the environment. Uploads to
`s3://${AWS_S3_BUCKET}/agent-platform/widget/widget.js` with public-read
ACL, `Cache-Control: public, max-age=300`,
`Content-Type: application/javascript`. Pass `--skip-build` to upload an
already-built bundle.

**No new bucket required.** Re-uses the same bucket the rest of the
platform writes to.

## Vercel CSP for /embed/*

`costkatana-frontend/vercel.json` already includes a per-route header
override for `/embed/*` (`Content-Security-Policy: frame-ancestors *`)
that allows the iframe to be embedded on arbitrary third-party origins.
No additional config needed.

## Postmessage protocol

The iframe sends these to the parent (the customer's page):

| Message | Description |
|---|---|
| `{ type: 'costkatana-widget:close', deploymentId }` | User clicked close. |
| `{ type: 'costkatana-widget:resize', deploymentId, height: number }` | Resize (clamped 360–800 px). |

Messages from origins other than `data-app-base` are ignored.
