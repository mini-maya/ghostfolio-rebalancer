# Ghostfolio Rebalancer

Standalone Angular web app for loading holdings from a remote Ghostfolio instance
and calculating a contribution-based rebalancing plan.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshot_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshot_light.png">
  <img alt="Screenshot" src="screenshot_light.png">
</picture>

## Quick Start (pre-built image)

No build step required – pull the ready-made image directly from the GitHub
Container Registry:

```bash
docker run --rm -p 8080:80 \
  -e BASE_URL="https://ghostfolio.example.com" \
  -e ACCESS_TOKEN="your-access-token" \
  -e ALLOCATIONS_TEXT="EXV1.DE,40;IS3N.DE,60" \
  ghcr.io/mini-maya/ghostfolio-rebalancer:latest
```

Then open **http://localhost:8080** in your browser.

| Environment variable | Description | Example |
|---|---|---|
| `BASE_URL` | URL of your Ghostfolio instance | `https://ghostfolio.lan` |
| `ACCESS_TOKEN` | Ghostfolio account access token | `abc123` |
| `ALLOCATIONS_TEXT` | Target allocations (`SYMBOL,PERCENT` pairs separated by `;`) | `EXV1.DE,40;IS3N.DE,60` |

All three variables are optional – they pre-fill the **Advanced settings** section
and can be changed at any time in the UI without restarting the container.

### Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  ghostfolio-rebalancer:
    image: ghcr.io/mini-maya/ghostfolio-rebalancer:latest
    ports:
      - "8080:80"
    environment:
      BASE_URL: "https://ghostfolio.example.com"
      ACCESS_TOKEN: "your-access-token"
      ALLOCATIONS_TEXT: "EXV1.DE,40;IS3N.DE,60"
```

Then start with:

```bash
docker compose up
```

> **Note:** `ACCESS_TOKEN` is delivered to the browser as part of the runtime
> configuration. Use this only in a trusted/internal network.

---

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

## Docker (build from source)

```bash
docker build -t ghostfolio-rebalancer .
docker run --rm -p 8080:80 \
  -e BASE_URL="https://ghostfolio.lan" \
  -e ACCESS_TOKEN="your-access-token" \
  -e ALLOCATIONS_TEXT="EXV1.DE,40;IS3N.DE,60" \
  ghostfolio-rebalancer
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
