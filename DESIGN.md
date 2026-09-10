---
name: LEGO Piano Jukebox
description: Une interface gravée comme une partition — encre bleue Epitech sur papier blanc, réglure à pas constant, aplat réservé à ce qui agit ou à ce qui sonne.
colors:
  epitech-blue: "#013afb"
  epitech-blue-hi: "#3d63ff"
  epitech-blue-edge: "#0130d0"
  rule-blue: "#a9bcff"
  paper: "#ffffff"
  paper-recessed: "#f4f6fc"
  ink: "#0b1633"
  ink-2: "#35406b"
  ink-3: "#5a6591"
  line: "#c5d0ee"
  line-soft: "#dde4f5"
  on-accent: "#ffffff"
  tech-green: "#00a86b"
  tech-green-ink: "#00714a"
  together-orange: "#d1481c"
  tomorrow-magenta: "#b900b2"
  trace-alert: "#c2400f"
  plate-keybed: "#001a7a"
  score-paper-warm: "#f7f2e7"
  score-ink-warm: "#221d18"
typography:
  display:
    fontFamily: "Anton, Impact, Haettenschweiler, Arial Narrow Bold, sans-serif"
    fontSize: "clamp(38px, 6.4vw, 86px)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.005em"
  display-plate:
    fontFamily: "Anton, Impact, Haettenschweiler, Arial Narrow Bold, sans-serif"
    fontSize: "clamp(44px, 7vw, 104px)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "Anton, Impact, Haettenschweiler, Arial Narrow Bold, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0.04em"
  title:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.14em"
  marker:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.1em"
    fontFeature: "tabular-nums"
  expression:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    fontStyle: "italic"
    letterSpacing: "0.01em"
rounded:
  none: "0px"
spacing:
  stave: "8px"
  pitch: "32px"
  brace: "22px"
  brace-plate: "40px"
  row: "64px"
components:
  button-play:
    backgroundColor: "{colors.epitech-blue}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.none}"
    width: "58px"
    height: "58px"
  button-play-hover:
    backgroundColor: "{colors.epitech-blue-edge}"
    textColor: "{colors.on-accent}"
  button-play-plate:
    backgroundColor: "{colors.on-accent}"
    textColor: "{colors.epitech-blue}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 15px"
  button-outline-hover:
    backgroundColor: "transparent"
    textColor: "{colors.epitech-blue}"
  marker-square:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.marker}"
    rounded: "{rounded.none}"
    padding: "3px 9px"
  marker-square-active:
    backgroundColor: "{colors.epitech-blue}"
    textColor: "{colors.on-accent}"
  input-field:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "13px 14px"
  catalogue-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "64px"
  catalogue-row-hover:
    backgroundColor: "#013afb0a"
  section-head:
    backgroundColor: "transparent"
    textColor: "{colors.epitech-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "32px"
---

# Design System: LEGO Piano Jukebox

## Overview

**Creative North Star: "La Gravure" — the engraved score**

The product already engraves music: `web/js/music/score.js` draws its clefs, its
brace and its barlines as pen strokes on paper. That language is now the whole
interface's. The page is a plate: white paper, one blue ink, a horizontal
rule-grid (*la réglure*) at a constant step, blocks that sit **on** the lines and
never between them, square markers instead of pills, section punctuation written
as a double barline, and machine readings set in italic where a score sets its
dynamics. The two keyboards — the 88-key score staff and the 25-key LEGO model —
are not two panels but two staves of one system, tied by a drawn brace and
crossed by a single cursor.

Density is editorial, not dashboard: no cards, no drop shadows, no rounded
corners, no gradients on the Epitech surfaces. Depth is made only by line weight
and by the difference between an outline and a fill. Two visual rejections are
confirmed by the build itself and stated in the source: the dark player card with
a square cover art and a transport bar, and its opposite, the light dashboard of
white rounded cards. Both are the application's two other themes, still shipped
and still coherent in their own worlds; the Epitech default refuses both.

Scale is a shipping requirement, not a preference: the screen is read at 3 m at an
open day and 10 m at a trade show. The kiosk mode (`data-kiosk="1"`) does not
enlarge the interface, it **reverses the plate** — blue floods the frame, the
engraving becomes white reserve, and the operator chrome disappears.

**Key Characteristics:**
- One ink on a blue axis; never a neutral black, not even under a scrim.
- Line at rest, solid fill only for what is actionable or currently sounding.
- Everything on a rule of 8px, blocks on a step of 32px, catalogue rows exactly 64px.
- Zero radius, zero shadow, zero gradient on Epitech surfaces.
- One brace, one cursor, one CSS variable; no per-widget animation.

## Colors

A two-value palette: Epitech blue and the blue-tinted paper it is drawn on, with
the school's Tech/Together/Tomorrow triptych held in reserve for meaning only.

### Primary
- **Epitech Blue** (`{colors.epitech-blue}`): the ink. Rules, hairlines, the
  brace, the staves, markers, section titles, the cursor, the sounding key, the
  play button, the range thumb. It is also the flood colour of the kiosk plate.
- **Ink Deep** (`{colors.epitech-blue-edge}`): hover and pressed state of the one
  solid blue control; also the recessed background of the plate.
- **Rule Blue** (`{colors.rule-blue}`): the tint of a marker's border when it is
  a marker of the blue family but not itself active.

### Neutral
- **Paper** (`{colors.paper}`): the sheet. Page, panels, telemetry console, score
  desk under the charter — one surface colour, not a stack of tinted planes.
- **Recessed Paper** (`{colors.paper-recessed}`): fields, wells, drawer bodies.
- **Pen Ink** (`{colors.ink}`): running text. A blue-black, dark enough for long
  reading, never the neutral `#181818` of a screen theme.
- **Ink Second** (`{colors.ink-2}`) / **Ink Third** (`{colors.ink-3}`): composer
  line, expression line, counts, hints, placeholders, scrollbar thumb on hover.
- **Rule** (`{colors.line}`) and **Soft Rule** (`{colors.line-soft}`): the
  engraving's hairlines — margin between stage and catalogue, row separators,
  control outlines, blueprint grid on the remote.

### Tertiary — the charter triptych, as meaning only
- **Tech Green** (`{colors.tech-green}` / text `{colors.tech-green-ink}`): agreement, success.
- **Together Orange** (`{colors.together-orange}`): warning.
- **Tomorrow Magenta** (`{colors.tomorrow-magenta}`): error.
- **Trace Alert** (`{colors.trace-alert}`): the one warm trace in the conductor
  panel, drawn in ink weight, and only when a threshold is actually crossed.

### Named Rules
**The Two-Value Ink Rule.** Blue at rest is a *line*; blue as a **solid fill**
appears only on what is actionable or what is sounding right now. A key that
sounds, the play button, a selected chip, an active marker, the visitor's own
queue rank: that is the whole list. Audit test — count the solid blue areas in a
region; more than one and one of them is not doing anything.

**The No Neutral Black Rule.** Every ink value sits on the blue axis, including
tokens nobody reads as text: scrim `#0b1633a6`, sunken `#0b16330a`. If a value is
grey or black, it belongs to another theme, not to this one.

**The Third Inkwell Rule.** A marker that does nothing gets no colour of its own.
Format tags (`MIDI`, `Audio`) are both blue outlines; a second accent hue would
claim an affordance that does not exist.

**The Plate Reversal Rule.** Kiosk mode inverts the tokens, not the layout:
`--bg`, `--panel` and `--topbar-bg` become the blue, `--ink` becomes white, and
`--accent` becomes white so that reserve is what marks. Nothing is restyled
individually; one token block and the whole system follows.

## Typography

**Display Font:** Anton (self-hosted `web/assets/brand/fonts/Anton-Regular.ttf`,
single weight 400, `font-display: swap`; falls back to Impact / Haettenschweiler
/ Arial Narrow Bold)
**Body Font:** IBM Plex Sans (self-hosted variable, upright and italic, weights
100–700; falls back to the system UI stack)
**Label/Mono Font:** none shipped. `--mono` names *IBM Plex Mono*, but no such
file is served from `web/assets/brand/fonts/`; every `var(--mono)` run therefore
renders in the system monospace stack (`ui-monospace`, SFMono-Regular, Menlo,
Consolas). Treat mono as a system face until the file ships.

**Character:** a condensed, single-weight poster face against a humanist grotesk
with a real italic. Anton carries the work title at engraving scale; Plex carries
everything that has to be read, and its italic carries everything the machine
says about itself.

### Hierarchy
- **Display** (Anton 400, `clamp(38px, 6.4vw, 86px)`, line-height 1.02,
  tracking −0.005em, uppercase): the work title, one per screen. On the kiosk
  plate it rises to `clamp(44px, 7vw, 104px)`.
- **Headline** (Anton 600, 20px, tracking 0.04em, uppercase): the brand block,
  the catalogue heading, drawer and panel titles.
- **Title** (Plex 600, 15px): track names, card names in the conductor panel.
- **Body** (Plex 400, 15px/1.5 on the jukebox, 16px/1.45 on the remote — 16px is
  the floor below which iOS auto-zooms a field): running text, hints, leads.
- **Label** (Plex 600, 11px, tracking 0.14em, uppercase): staff names
  (`PARTITION_`, `MODÈLE LEGO — ARBRE À CAMES_`), section heads on the remote at
  13px/0.14em.
- **Marker** (Plex 400, 11px, tracking 0.1em, uppercase, tabular figures,
  padding 3px 9px): the square rehearsal marks — format, note count, BPM, metre.
- **Expression** (Plex 400 **italic**, 13.5px, tracking 0.01em): what the machine
  is doing, set under the system exactly where a score writes its dynamics.

### Named Rules
**The Underscore Rule.** The charter's title punctuation is a trailing `_` in the
accent, generated with `::after` on section titles and staff names. It is
punctuation, never a decoration and never applied to body copy.

**The Tabular Rule.** Any figure that changes in place — clock, BPM, counts,
battery, queue rank — carries `font-variant-numeric: tabular-nums`. A line that
dances while a number ticks is a defect.

**The One Title Rule.** Anton at display scale appears once per screen, on the
work title. Everything else that uses Anton is at 20px or below.

## Layout

The page is ruled. `--stave: 8px` is the staff interline; `--pitch:
calc(var(--stave) * 4)` = **32px** is the step, and it is deliberately equal to
the 32px cell of the charter's blueprint grid so that the two trames are
commensurable and a block can be *seen* touching a line. Every block spacing on
the Epitech surfaces is an integer multiple of the stave: stage gap and padding
`var(--pitch)`, stave-to-stave gap `var(--pitch)`, title block gap
`calc(var(--stave) * 2)`, composer rule `calc(var(--stave) * 1)`.

The jukebox is two columns — `minmax(0, 1fr)` for the stage and
`minmax(320px, 400px)` for the catalogue — separated not by a gutter but by a
single left hairline on the catalogue, like the margin between two systems on a
page. Gap is 0 by design.

A catalogue row measures **exactly 64px** (two grid cells), verified in pixels:
`min-height: calc(var(--pitch) * 2)`, zero block padding, list gap 0, inner `ol`
gap and padding-bottom zeroed, and the separator drawn as an inset `::after`
hairline so the border is inside the cell rather than adding to it. A section
band is exactly 32px. Groups are separated by one `--pitch`.

The remote is a single 16px-gutter column on the blueprint grid (two 32px
repeating linear-gradients, fixed attachment), with safe-area insets top and
bottom; all its rhythm is multiples of its own `--stave: 8px`. Its touch targets
are 52px minimum.

At ≤ the topbar's breakpoint the hub state moves to its own line and the actions
wrap below, preserving DOM order for the keyboard. In kiosk mode the entire plate
scales together — keyboards, cover, markers, transport, brace weight
(`stroke-width: 2.6`), cursor width (3px) and brace gutter (40px) — because
enlarging only the title would be a monument set on a dashboard.

### Named Rules
**The Réglure Rule.** Every vertical measurement on an Epitech surface is
`calc(var(--stave) * n)` or `calc(var(--pitch) * n)`. No loose pixel values, no
`gap: 6px` sneaking in from a sibling rule. Audit test — measure a catalogue row;
if it is not 64px, something outside the block is adding drift.

**The Closed Page Rule.** An engraved page ends, it does not trail off. The stage
closes on a final double barline (`.stage::after`: 1px rule over a 3px rule).

## Elevation & Depth

**There are no shadows.** `--shadow` is `none` under Epitech and the panels carry
`box-shadow: none` explicitly. Depth is made by three means only: the weight of a
line (1px hairline, 1.5px accent rule, 3px double barline), the difference
between an outline and a solid fill, and — on the plate — the inversion of ink
and paper. Backgrounds are transparent almost everywhere: the stage, the
catalogue, the keybed (`--kbd-bg: transparent`), the controls and the telemetry
cards are all the sheet itself.

### Named Rules
**The Filet, Not the Shadow Rule.** Where another system would lift a surface,
this one draws a rule. A separation is a hairline; an emphasis is a 1.5px accent
line; a conclusion is a double barline. Never a drop shadow, never a border-radius,
never a gradient — including on avatars, covers and gauges.

## Shapes

Radius is **0** everywhere on the Epitech surfaces: `--radius-sm`, `--radius`,
`--radius-lg` and `--radius-round` are all `0px`, which squares the buttons,
markers, chips, tags, toasts, rows, range track and thumb, the status dot and the
activity LED in one stroke. Angles are frank because the charter is made of
squares and pixels.

The recurring silhouettes are engraving marks:
- **The brace** — an SVG stroke (`vector-effect: non-scaling-stroke`, 1.6, 2.6 on
  the plate) spanning the full height of the system, in a dedicated left gutter.
- **The double barline** — `inset 0 -1px 0 var(--accent)` over
  `inset 0 -5px 0 -2px var(--accent)` under a section head; `3px double` on the
  remote's section titles. Horizontal, always, and always closing something.
- **The square marker** — a 1px outlined rectangle with wide tracking.
- **The hairpin** — the motor gauge is a `clip-path: polygon(0 100%, 100% 0,
  100% 100%)` crescendo, not a progress bar.
- **The empty staff** — the resting cover art is an inline SVG of five blue rules
  on white: the page waiting for its work.

## Components

### Buttons
- **Shape:** perfectly square corners (0px), 1px outline, transparent ground.
- **Play (the one solid):** solid Epitech blue, white glyph, 58px square
  (64px round controls / 84px play in kiosk). Hover deepens to
  `{colors.epitech-blue-edge}`. On the reversed plate it becomes white on blue.
- **Outline / icon / transport:** transparent ground, `{colors.line}` border,
  ink glyph; hover moves border and glyph to the accent. Padding 9px 15px, icon
  buttons 9px, round controls 44px square (52px in kiosk).
- **Focus:** `2px solid var(--accent)` outline at 2px offset, globally on
  `:focus-visible`. Active state nudges 1px down; transitions are 0.15s on
  colour only.
- **Toggle (`aria-pressed="true"`):** inverts to the solid — accent ground, white
  glyph. This is the same rule as the play button: pressed means acting.

### Chips (remote)
- **Style:** square, 1px `{colors.line}` outline, transparent ground, Plex 600
  14px, `{colors.ink-2}`, padding 9px 15px, in a horizontally scrolling row with
  the scrollbar hidden.
- **State:** `aria-selected="true"` fills solid blue with white text.

### Cards / Containers
There are no cards. The stage and the catalogue are regions of one sheet:
`border-radius: 0`, `background: transparent`, `border: 0`, `box-shadow: none`;
the catalogue carries a single `border-left: 1px solid var(--line)` and
`padding-left: clamp(18px, 2.4vw, 30px)`. Internal padding is `var(--pitch)`.

### Inputs / Fields
- **Style:** transparent ground, 1px `{colors.line}` border, 0 radius, padding
  13px 14px, 16px text on the remote.
- **Focus:** the global accent focus ring; no glow, no border colour animation.
- **Range:** a 2px `{colors.line}` track with a square solid-accent thumb.
- **Browser surfaces are themed, not left to factory settings:**
  `::selection` is accent-on-white, `caret-color` and `accent-color` are the
  accent, and scrollbars are thin `{colors.line}` thumbs on a transparent track.

### Navigation
The topbar is a full-width head rule: logo, `JUKEBOX` in Anton, the hub state in
expression italic, then outlined controls; closed by a `1.5px solid var(--accent)`
bottom rule. In kiosk mode it doubles in scale, the rule softens to `--line`, the
operator controls (`#btn-connect`, both hub pills) are hidden, and the logo sits
in a **white reserve** (`background: #ffffff; padding: 7px 12px`) because the
charter forbids recolouring it or placing it without contrast.

### The System (signature)
The two keyboards are one system. `.system` reserves a left gutter of
`calc(var(--brace-w) + 4px)`; `.system-brace` is an SVG stroke spanning
`height: 100%`; `.system-cursor` is a 2px accent line positioned at
`left: calc(var(--brace-w) + (100% - var(--brace-w)) * var(--t, 0))` and revealed
at 0.9 opacity only while `#btn-play[data-playing="1"]`. `--t` is written once
per frame on `document.documentElement` by `main.js`; every region tied by the
brace redraws from that one variable.

### Keys as pen strokes
A white key is **one hairline right border** (`color-mix(in srgb, var(--accent)
46%, transparent)`) on transparent ground — no ivory, no gloss, no shadow. A
black key is flat accent ink at **0.45** opacity (0.34 on the reversed plate),
filled the way an engraver distinguishes degrees. A **sounding** key is the full
solid: `background: var(--accent)`, opacity 1 — white reserve on the plate. The
keybed is bounded top and bottom by a 1.5px accent rule and is otherwise paper.

### The Conductor (telemetry)
The geek panel is a conductor's score on the same paper: white ground, a 1.5px
accent top rule instead of a panel shadow, staff names set right-aligned to the
left of each system behind a hairline (`148px` column) rather than as card
titles, traces drawn as hairlines (`--geek-fill-alpha: 0` under Epitech, `.16` on
the dark themes), and a square solid activity mark with no pulse and no halo.
Alert ink is conditional: a trace only takes the warm colour when its threshold
is actually crossed (`alertBelow` in `geek.js`).

### The Score Desk
The score desk does not follow the theme by default — a score is read on paper,
and the shipped default is warm stock (`{colors.score-paper-warm}` /
`{colors.score-ink-warm}`). Under Epitech it is overridden to white paper, blue
ink `{colors.ink}` and a solid blue bar; on the reversed plate the bar deepens to
`{colors.plate-keybed}` and the desk keeps the blue for itself, because on white
paper white would mark nothing.

## Do's and Don'ts

### Do:
- **Do** put every measurement on the rule: `calc(var(--stave) * n)` (8px) or
  `calc(var(--pitch) * n)` (32px), and keep the 32px step aligned with the
  charter's blueprint cell.
- **Do** keep blue as a line at rest and reserve the solid fill for what is
  actionable or currently sounding — one solid per region.
- **Do** route all colour through CSS custom properties, and express a new theme
  as a `[data-theme="…"]` block; no hard-coded colour in a component rule.
- **Do** drive time-linked visuals from the single `--t` custom property written
  once per frame, and make gauges `transform: scaleX()` or `clip-path`, never an
  animated `width`.
- **Do** theme the browser's own surfaces: selection, caret, accent-color,
  focus ring, scrollbars.
- **Do** give any figure that updates in place `font-variant-numeric: tabular-nums`.
- **Do** close a page with a double barline rather than letting it trail into
  white space.
- **Do** place the Epitech logo in a white reserve whenever the ground is not
  white; never recolour it.

### Don't:
- **Don't** use a neutral black or grey on an Epitech surface — including scrims,
  sunken tints and hover washes. Ink is on the blue axis.
- **Don't** introduce a border radius, a drop shadow, or a gradient on an Epitech
  surface. Separation is a hairline; emphasis is a 1.5px rule.
- **Don't** rebuild the catalogue or the queue as stacked cards; they are ruled,
  numbered index lines.
- **Don't** animate anything beyond the two movements — the cursor advancing
  linearly at the speed of musical time, and a notehead inking. Nothing slides,
  nothing bounces, nothing pulses at rest.
- **Don't** give a non-interactive marker its own hue; a third inkwell claims an
  affordance that does not exist.
- **Don't** colour a telemetry trace as an alert unless a threshold is actually
  crossed, and don't fill a trace on paper — a fill on this surface means
  "acting" or "sounding".
- **Don't** add a per-widget animation or a second time source; anything tied to
  musical time reads `--t`.
