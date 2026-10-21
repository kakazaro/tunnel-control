# UI design: "Holo-HUD control deck"

One full-screen page (`/`) with two states, **locked** and **unlocked**. Login is not a route: the
"ACCESS TERMINAL" floats over the dormant deck, and after a successful login the deck powers up in place.
Style: dark sci-fi command deck, neon light, holographic glass panels, purposeful motion
(*HUD / Sci-Fi FUI* + *Cyberpunk UI*).

## Tokens (`web/src/client/styles/tokens.css`)

This file is the only place for raw colors and fonts. Tailwind turns the `--color-*` / `--font-*` tokens into utilities.

| Token | Value | Use |
|---|---|---|
| `bg` | `#05060f` | Page background (deep space) |
| `surface` | `rgb(16 20 44 / 0.55)` + blur | Holographic glass panels |
| `line` / `line-strong` | cyan at 25% / 55% | Borders, grid lines |
| `neon-cyan` | `#00e5ff` | Primary: headings, focus, links |
| `neon-magenta` | `#ff2bd6` | Accent: stopped reactor, command events |
| `neon-violet` | `#7c3aed` | Nebula, gradients |
| `ok` / `warn` / `danger` | `#39ff88` / `#ffb020` / `#ff3b5c` | Running / pending / error |
| `text` / `text-muted` | `#e6f1ff` / `#8a9bc2` | Body / secondary text |

Fonts: **Orbitron** (display: logo, headings, big numbers) and **JetBrains Mono** (everything else), self-hosted through
`@fontsource` (latin subset), so the page makes no third-party requests. Numbers use tabular figures.

## Layout

- Full viewport: `100dvh`, edge to edge, no page scroll from 768px up; panels scroll inside themselves.
- ≥ 1024px: three columns (status + tunnel | reactor | events). 768-1023px: two columns. Below 768px: a vertical stack,
  reactor first, and the page scrolls.
- A header button toggles real full screen (Fullscreen API; hidden where unsupported).

## Components

| Component | Notes |
|---|---|
| `Stage` | Background: drifting nebula, perspective neon grid floor, scanlines, grain (CSS only). |
| `HoloPanel` | Glass panel, corner brackets, rotating border sheen, cursor spotlight, ≤ 4° tilt (mouse only). |
| `ReactorButton` | The power control; one real `<button>` with `aria-pressed` and a visible ENGAGE/DISENGAGE label. States: stopped (magenta, breathing), charging (amber, spinning rings + sweeping arc), running (green, counter-rotating rings). |
| `SessionModal` | "Session time" dialog: required choice of 1, 2, 4, 8 or 12 hours. |
| `StatusCard` | Agent badge, host, link (signal bars), last seen, desired/actual. |
| `TunnelCard` | URL (decrypt effect), copy, uptime, **session left** countdown, cloudflared version, public-URL notice. |
| `EventList` | Terminal-style log; new rows slide in and type out. |
| `ErrorBanner` | Red alert strip for `lastError` and API errors. |
| `LockPanel` | The login form with a typed boot sequence. |

## Starting a tunnel

Clicking **ENGAGE** opens the **Session time** dialog. Nothing is preselected and **LAUNCH SESSION** stays disabled until a
length is chosen. Esc, the backdrop, the X and Cancel close it without starting. On launch the dialog bursts and closes, and
the reactor charges. **DISENGAGE** stops immediately (no dialog). While a session runs, the Tunnel panel shows a
`SESSION LEFT` countdown that turns amber and flickers in the last five minutes. At zero the server stops the session
(event `SESSION END`) and the agent closes the tunnel.

## Every action has an animation

| Action / event | Animation |
|---|---|
| Page load (locked) | Grid and nebula fade in; the dormant deck flickers on like a CRT; the lock panel types its boot lines |
| Typing the password | The underline glows while focused |
| Submit (waiting) | Spinner and "AUTHENTICATING…" |
| Wrong password / 429 | Panel shake + glitch + red "ACCESS DENIED" (or a "LOCKED OUT · RETRY IN …s" countdown) |
| Login success | "ACCESS GRANTED", burst of light, scan wipe, panels power up one by one, numbers count up |
| Data refresh (every 5s) | Only the header SYNC dot pulses; changed values flash softly |
| Agent goes online / offline | Radar ping and green border / red flicker, glitch, "SIGNAL LOST" |
| WebSocket up / down | Signal bars rise; badge morphs between LIVE LINK and POLLING |
| Click ENGAGE | Session dialog opens (blur-in, spring); the choice highlight slides between options |
| Launch session | Burst, dialog closes, shockwave ripple from the reactor, rings spin up, arc sweeps |
| Tunnel started (URL arrives) | Beam sweeps across the tunnel panel, URL decrypts into place, uptime ticks |
| URL changed | Old URL glitches out, new one decrypts in |
| DISENGAGE | Rings slow down and collapse, core dims, URL fades to OFFLINE |
| Copy URL | "COPIED" toast floats up |
| New event | Row slides in with a glow and a typewriter reveal |
| Error | Alert strip glitches in once, slides away when resolved |
| Stale data | Static noise overlay and a "STALE" tag |
| Logout / session lost | Panels power down in reverse order, the lock panel re-forms |
| Toggle effects | Instant switch between full and reduced |

## Accessibility and effects control

- `prefers-reduced-motion` and the in-app **FX: FULL / REDUCED** toggle (saved in `localStorage` as `tc.fx`) switch off tilt,
  glitch, scramble, burst, shake, scanlines, the grid scroll and the power-up stagger. Actions then fall back to a plain
  fade or color change. If the OS asks for reduced motion, the toggle is locked.
- Ambient loops pause while the tab is hidden (`data-hidden` on `<html>`).
- Text contrast ≥ 4.5:1; neon colors are accents. State is never color alone (always an icon and text).
- Nothing flashes more than three times a second; glitches last ≤ 300ms.
- Visible 2px cyan focus ring everywhere; touch targets ≥ 44px; the dialog traps focus, restores it on close, and closes on Esc.
- Animate only `transform`, `opacity` and `filter`.

## Performance budget

Initial JS ≤ 200 KB gzipped (currently about 180 KB), no canvas or WebGL, at most two `backdrop-filter` surfaces per area.
