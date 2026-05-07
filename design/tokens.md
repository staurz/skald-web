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

- `drift` keyframe: 38 s ease-in-out alternate. Slow enough to feel atmospheric, not animated.
- `pulse` on the heating indicator: 2.4 s ease-in-out. The only "alive" element when nothing else is changing.
- All other transitions: 0.4 s `cubic-bezier(0.2, 0.8, 0.2, 1)`. Soft snap.
- No hover wiggles, no entrance bounces, no scroll reveals. The vibe is meditative.

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
