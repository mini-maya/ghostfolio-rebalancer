# Ghostfolio Rebalancer

Standalone Angular web app for loading holdings from a remote Ghostfolio instance
and calculating a contribution-based rebalancing plan.

## Local development

```bash
npm install
npm start
```

The app expects:

1. A Ghostfolio base URL
2. An account access token
3. A target-allocation list in the format `SYMBOL,PERCENT;SYMBOL,PERCENT`

The browser calls the remote Ghostfolio instance directly, so the target instance
must allow the necessary CORS requests.

## Production build

```bash
npm run build
```

## Docker

```bash
docker build -t ghostfolio-rebalancer .
docker run --rm -p 8080:80 \
  -e BASE_URL="https://ghostfolio.lan" \
  -e ACCESS_TOKEN="your-access-token" \
  -e ALLOCATIONS_TEXT="EXV1.DE,40;IS3N.DE,60" \
  ghostfolio-rebalancer
```

```bash
docker compose -f docker-compose.build.yml up --build
```

Then open `http://localhost:8080`.

For Docker Compose:

```bash
docker compose -f docker-compose.build.yml up --build
docker compose up
```

`docker-compose.build.yml` builds the image, while `docker-compose.yml` only
starts an existing `ghostfolio-rebalancer:latest` image.

The checked-in `.env` file is used by default; `.env.example` is provided as a
template if you want to recreate it.

The values from `BASE_URL`, `ACCESS_TOKEN`, and `ALLOCATIONS_TEXT` are loaded as
editable defaults into the collapsed **Advanced settings** section. The main view
shows **Monthly rate**, **Minimum buy amount**, **Rounding step**, and
**Load holdings** directly.

`ALLOCATIONS_TEXT` and the visible text field both expect the compact format
`SYMBOL,PERCENT;SYMBOL,PERCENT`.
Without `ALLOCATIONS_TEXT`, the field starts empty and only shows the placeholder
example in the UI.

The rounding step defaults to `10.00`. Setting it to `0` disables rounding and
keeps the normalized buy amounts at exact cent precision.

Use the theme selector in the top bar to switch between System, Light, and Dark;
the chosen theme is remembered in the browser.

Be aware that `ACCESS_TOKEN` is delivered to the browser as part of the runtime
configuration for this client-side app. Treat this deployment as trusted/internal
only if you use a prefilled token.
