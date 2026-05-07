# Skålda — Design Tokens

Single source of truth for the visual system. Reference this when implementing Tasks 17–20, 23, 26 in the v1 plan. The mockup at `design/dashboard-preview.html` realises these tokens in HTML — open it in a browser to evaluate.

## Concept

**"Steam in cold air."** Cold midnight blue above, warm copper-amber glow rising from below, soft cream typography floating in between. The interface mirrors the lived experience of the spa: cold outdoor air, hot water, steam between. Heating is a thermal hue across the whole UI, not a status icon.

Dark-mode primary. Light mode possible later but not v1.

## Type

**Display + body + numbers:** [Fraunces](https://fonts.google.com/specimen/Fraunces) (Google Fonts variable). Variable axes used:
- `opsz` — optical size; we sweep 14 (small body) → 144 (giant hero numbers)
- `wght` — weight; 240–500 depending on context
- `SOFT` — softness; 50–100 for warmer character
- italic axis used for the wordmark

**Mono labels:** [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) for technical labels, timestamps, range descriptors. 0.62–0.72 rem, tracked +0.16em–0.20em, often UPPERCASE.

**Why not Inter/Roboto/Geist:** every dashboard uses them. Fraunces' editorial character makes the numbers feel hand-set, almost classical, like temperatures on an antique thermometer. That's the differentiator.

**Type scale (rem):**

| Use | Family | Size | Weight | Notes |
|---|---|---|---|---|
| Hero number | Fraunces | clamp(8, 32vw, 16) | 240 | opsz 144, SOFT 100, line-height 0.82, letter-spacing -0.045em |
| Hero unit (°F) | Fraunces | 0.22em (of hero) | 350 | opsz 60 |
| Section heading | Fraunces | 1 | 400 | opsz 24 |
| Card-label | JetBrains Mono | 0.68 | 500 | uppercase, tracking 0.20em |
| Chemistry value | Fraunces | 2.5 | 280 | opsz 96, SOFT 60 |
| Body | Fraunces | 0.9–1 | 400 | opsz 14 |
| Mono small | JetBrains Mono | 0.62–0.66 | 400 | tracking 0.10–0.18em |

## Color

```
--ink:          #0a1320       /* base — cold midnight */
--ink-2:        #122035       /* card surface low */
--ink-3:        #1a2b44       /* card surface mid */
--ink-4:        #243a58       /* card surface elev */

--paper:        #f3ede0       /* warm cream — primary text */
--paper-soft:   rgba(243, 237, 224, 0.72)   /* secondary text */
--paper-mute:   rgba(243, 237, 224, 0.46)   /* labels */
--paper-faint:  rgba(243, 237, 224, 0.18)   /* axis lines, helpers */
--paper-line:   rgba(243, 237, 224, 0.08)   /* card borders */

--copper:       #cc7c3a       /* heating active, primary accent */
--copper-dim:   rgba(204, 124, 58, 0.50)
--copper-aura:  rgba(204, 124, 58, 0.18)
--amber:        #d9a460       /* warning state, lights-on */
--moss:         #8aa68d       /* in-range / good */
--rust:         #c25b48       /* error / out-of-range */
--pearl:        #d4c8b4       /* subtle highlight */
```

**Usage rules:**
- 70 % of any screen = `--ink` family. Backgrounds dominate; foregrounds are sparse and meaningful.
- Copper is reserved for live state (heating, active accessories). Don't use it for chrome.
- Amber and rust are state colours, not decoration. A red number means something is wrong.
- Moss appears once chemistry is in range; it should feel earned, not default.

## Spacing & radii

Multiples of 4. Generous on mobile, more generous on desktop.

```
--r-sm: 14px       /* small interactive elements */
--r-md: 22px       /* accessory tiles */
--r-lg: 30px       /* main cards */
```

Card padding: 28 px on mobile, 32 px on desktop.
Card-to-card gap: 18 px on mobile, 22 px on desktop.

## Atmosphere (the signature)

Two fixed layers behind everything:

```css
body::before {
  /* Warm glow rising from below + cool tone above */
  background:
    radial-gradient(ellipse 90% 70% at 50% 115%, var(--copper-aura), transparent 60%),
    radial-gradient(ellipse 100% 80% at 50% 100%, rgba(217,164,96,0.08), transparent 70%),
    radial-gradient(ellipse 60% 40% at 70% -10%, rgba(36,58,88,0.5), transparent 60%),
    radial-gradient(ellipse 50% 30% at 20% 0%, rgba(36,58,88,0.4), transparent 60%);
  animation: drift 38s ease-in-out infinite alternate;
}

body::after {
  /* Subtle film grain — multiplies depth, prevents plastic feel */
  background-image:
    radial-gradient(rgba(243,237,224,0.022) 1px, transparent 1px),
    radial-gradient(rgba(243,237,224,0.012) 1px, transparent 1px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 1px 2px;
  mix-blend-mode: overlay;
}
```

**Heat-status thermal hue:** when `state.heating === true`, set the body class `is-heating`. Increase copper-aura saturation and intensity. The whole app warms up.

```css
body.is-heating::before {
  filter: saturate(1.15) brightness(1.05);
}
```

## Motion

The motion budget is deliberately small. Three discrete uses, no others:

**1. Atmospheric drift (always present, almost subliminal).**
- `drift` keyframe on `body::before`: 38 s ease-in-out alternate. The gradient field shifts a few pixels, evoking slow respiration.
- Slow enough that you don't notice it animating — you notice that the page feels alive.

**2. Heating pulse (only when state.heating === true).**
- `pulse` on the indicator dot inside the hero status pill: 2.4 s ease-in-out, opacity 1 → 0.45 → 1, scale 1 → 0.85 → 1.
- The only thing on screen that visibly moves when the system is at rest. It's the heartbeat of the heat.

**3. Page-load choreography (once, on app open).**
A single staggered reveal — the app's entrance moment — and nothing else. Implemented with CSS `animation-delay`:

| Element | Animation | Delay |
|---|---|---|
| topbar | `rise` 0.7s | 0 |
| hero block | `rise` 1.0s | 80 ms |
| **hero number** | `settle` 1.1s (custom) | 180 ms |
| accessories card | `rise` 0.9s | 240 ms |
| chemistry card | `rise` 0.9s | 320 ms |
| sparkline / desktop side | `rise` 0.9s | 400 ms |
| alerts card | `rise` 0.9s | 480 ms |
| footer stamp | `rise` 0.9s | 560 ms |

`rise`: `opacity 0 → 1`, `translateY(12px → 0)`, easing `cubic-bezier(0.2, 0.8, 0.2, 1)`.

`settle` is the hero number's special move — Fraunces' wght axis shifts from 200 to 240 and letter-spacing tightens from -0.06em to -0.045em while fading in. The number visibly focuses into place, like a thermometer settling. Only visible for ~1 s but it's the most distinctive moment in the app.

**Reduced motion:** wrap all entrance animations in `@media (prefers-reduced-motion: no-preference)`. The drift and pulse stay, but the entrance choreography turns off — accessibility before delight.

**State-change transitions** (after the entrance):
- Numerical updates (temperature changing): `opacity 0.3s ease` with a brief `transform: translateY(2px)` when the digit changes. Don't redo the entrance.
- Card body changes (state going stale, accessory toggling): `transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)`.
- No hover wiggles, no scroll reveals, no entrance bounces on subsequent navigation.

## States

Beyond the happy path, the dashboard must look intentional in five other states. Mockups in `design/states.html`.

### Loading (~200–800 ms, between page-open and first MQTT message)
- Skeleton numbers with shimmering gradient (1.6 s ease-in-out infinite, background-position 100% → 0).
- Same colours as the regular UI just dimmer — `--paper-faint` to `--paper-line` gradient on text via `background-clip: text`.
- Status stamp reads `connecting…` instead of `updated 12 s ago`.
- No spinner. The shimmer signals "alive, just waiting".

### Stale (>5 min since last update, while still connected)
- Hero number colour drops from `--paper` to `--paper-mute` (about 50% opacity).
- Timestamp colour flips to `--amber` and reads e.g. `last seen 14 min ago`.
- Small amber pill below the number: `Connection silent — values may be outdated`.
- Nothing flashing or red — the data isn't *wrong*, just *old*.

### Active error (errors array non-empty)
- A rust-toned banner appears at the top of the dashboard, **above** the hero — physically the first thing the eye lands on.
- Background: `linear-gradient(90deg, rgba(194,91,72,0.20), rgba(194,91,72,0.08))`, border `1px rgba(194,91,72,0.4)`.
- Triangle-with-dot icon in `--rust` on the left.
- Title in Fraunces 1rem display weight, detail in mono. Time-since on the right.
- Tappable to expand. Multiple errors stack vertically with 8 px gaps.

### No Spa Boy data (chemistry card before any payload, or if hardware absent)
- Chemistry card replaced with a quiet placeholder block.
- Disabled-style sensor icon at top.
- Title: `Awaiting first reading` (display 1.15rem).
- Body: `No data has arrived on telemetry/spaboy yet. Values appear here once the sensor reports.`
- Mono pill at the bottom: `offline`.
- Distinct from "out of range": those use rust/amber colours on populated values, this is greyed-out and informational.

### Setup (no credentials configured)
- Defer detailed design to implementation. Use `design/dashboard-preview.html`'s palette and typography. Single full-page form, generous padding, two inputs (email + password), single button labelled `Connect`. Brief copy explaining what happens to the password (used once, hashed, raw discarded). One sentence, italic Fraunces, `--paper-soft` colour.

## Icon

Source: `design/icon.svg`. A miniature portrait of the dashboard's atmosphere — deep ink rounded square, copper-amber glow rising from the bottom, a single thin pearl line near the upper third (the "water surface"), a copper dot anchoring the lower centre (the "heating heart"), with a soft halo around it.

**Why this composition:** at 16px favicon size you still see *a warm point in a dark frame* — the spa's emotional shape. At 192/512px you see the full atmospheric portrait. Same gesture, scales down faithfully.

**Colour set used:**
- `--ink` (#0a1320) — base
- `--copper` (#cc7c3a) — heating dot + glow
- `--paper` (#f3ede0) at 30% opacity — surface line

**Generating PNGs from this SVG (Task 19 step 2 update):**
Replace the "drop in placeholder PNGs" instruction with: install `sharp` as a build-time dep, write a small Node script that reads `design/icon.svg` and outputs `static/icon-192.png` (192×192) and `static/icon-512.png` (512×512). Or run it once manually:

```bash
npm install --save-dev sharp
node -e "require('sharp')('design/icon.svg').resize(192, 192).png().toFile('static/icon-192.png')"
node -e "require('sharp')('design/icon.svg').resize(512, 512).png().toFile('static/icon-512.png')"
```

The SVG itself can also be referenced directly in the manifest as `{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }` for browsers that support it.

Preview at multiple sizes and contexts: `design/icon-preview.html`.

## Component primitives

| Component | Surface | Border | Notes |
|---|---|---|---|
| Card | linear-gradient(180deg, rgba(26,43,68,.62), rgba(18,32,53,.86)) + backdrop-blur(20px) | 1 px paper-line | Inner gradient highlight on top edge |
| Accessory tile | rgba(243,237,224,.04) when off | 1 px rgba(243,237,224,.06) | When `on`: copper aura beneath, copper border |
| Status pill | copper-aura background | 1 px copper-dim | mono caps, leading dot pulses |
| Chart line | copper stroke 1.6 | drop-shadow with copper-dim | Gradient fill underneath |

## Tailwind translation hint

The implementation uses Tailwind. Add to `tailwind.config.cjs`:

```js
theme: {
  extend: {
    colors: {
      ink:    { DEFAULT: '#0a1320', 2: '#122035', 3: '#1a2b44', 4: '#243a58' },
      paper:  { DEFAULT: '#f3ede0', soft: 'rgba(243,237,224,0.72)', mute: 'rgba(243,237,224,0.46)', faint: 'rgba(243,237,224,0.18)' },
      copper: { DEFAULT: '#cc7c3a', dim: 'rgba(204,124,58,0.5)', aura: 'rgba(204,124,58,0.18)' },
      amber:  '#d9a460',
      moss:   '#8aa68d',
      rust:   '#c25b48',
    },
    fontFamily: {
      display: ['Fraunces', 'Iowan Old Style', 'Georgia', 'serif'],
      mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
    },
    borderRadius: { sm: '14px', md: '22px', lg: '30px' },
  },
}
```

Then load fonts in `app.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,200..900,30..100;1,9..144,200..900,30..100&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

## What this changes in the implementation plan

The plan's UI tasks (17, 18, 19, 20, 23, 26) keep their **structure** — same components, same data flow — but their **styling** comes from this tokens file, not the placeholder Tailwind classes the plan currently uses. Concretely:

- Task 17 (TemperatureCard / AccessoryGrid / ChemistryCard): replace inline `border bg-white` styles with the card surfaces and atmospheric backgrounds from this file.
- Task 18 (Dashboard page): apply the topbar with the `Skålda` wordmark + dot, and the desktop two-column grid.
- Task 19 (PWA manifest): use `theme_color: "#0a1320"` and design custom icons in the same palette (warm circle on dark).
- Task 20 (layout): the `<body>::before` / `::after` atmospheric layers go in the layout's CSS. Keep the dark-mode toggle but default to dark.
- Task 23 (HistoryChart): swap the placeholder colours for `--copper` line + `sparkGradient` fill, axis lines in `--paper-faint`.
- Task 26 (alerts UI): use the alerts-summary block from the mockup as the visual reference.

No new tasks needed; existing tasks just implement against this design instead of inventing styling per file.
