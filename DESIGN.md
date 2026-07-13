---
name: WindowLLM
description: Bring your own AI to every website. A dark, gold-lit interface for a sovereign browser LLM.
colors:
  window-gold: "oklch(0.84 0.135 79)"
  gold-deep: "oklch(0.78 0.14 66)"
  gold-ink: "oklch(0.9 0.11 82)"
  vault-slate: "oklch(0.145 0.02 265)"
  slate-raised: "oklch(0.185 0.022 265)"
  slate-raised-2: "oklch(0.22 0.024 265)"
  ink: "oklch(0.97 0.008 265)"
  dim: "oklch(0.72 0.018 265)"
  faint: "oklch(0.58 0.016 265)"
  hairline: "oklch(1 0 0 / 0.09)"
  signal-indigo: "oklch(0.7 0.15 274)"
  ok-green: "oklch(0.8 0.14 155)"
  alert-red: "oklch(0.72 0.16 25)"
typography:
  display:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, sans-serif"
    fontSize: "clamp(2.6rem, 6.4vw, 4.7rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, sans-serif"
    fontSize: "clamp(1.5rem, 2.5vw, 1.9rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, sans-serif"
    fontSize: "1.12rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "ui-monospace, SF Mono, JetBrains Mono, Menlo, Consolas, monospace"
    fontSize: "0.78rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  sm: "7px"
  md: "10px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "0.5rem"
  sm: "0.85rem"
  md: "1.4rem"
  lg: "2rem"
  xl: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.window-gold}"
    textColor: "{colors.vault-slate}"
    rounded: "{rounded.md}"
    padding: "0.72rem 1.3rem"
  button-ghost:
    backgroundColor: "{colors.slate-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.72rem 1.3rem"
  card:
    backgroundColor: "{colors.slate-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "1.4rem 1.5rem"
  input:
    backgroundColor: "{colors.slate-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.8rem 1rem"
  kicker:
    textColor: "{colors.gold-ink}"
    typography: "{typography.label}"
---

# Design System: WindowLLM

## 1. Overview

**Creative North Star: "The Lit Window"**

WindowLLM is a warm light falling through a dark blueprint. The product's whole idea is a window a site opens onto the user's own AI, so the interface makes that window literal: a dark slate ground, a faint engineering grid, and warm gold light spilling in from the top-left corner as if through glass. Gold is the light inside the vault. Everything else is the room around it, kept deliberately quiet so the light reads.

The system is dark by conviction, not fashion. The scene is a developer evaluating a sovereignty tool: focused, a little nocturnal, wanting to trust what they see. So the surfaces are restrained and the geometry is tight, and confidence comes from precision rather than decoration. The signature move is the browser-window motif: chrome bar, three dots, a framed interior. It appears as the hero mock and echoes through cards and code frames.

This system explicitly rejects the generic AI-SaaS look: no purple-to-blue hero gradients, no neon-on-black, no glassmorphism as default, no wall of identical icon-heading-text cards. It also rejects dependency: the interface ships **no web fonts and makes no third-party requests**, the same sovereignty it sells, applied to itself.

**Key Characteristics:**
- Warm gold on deep blue-slate, dark by default.
- The browser window as a recurring literal motif (grid, light, chrome, frame).
- Flat surfaces at rest; light and lift only on interaction.
- System sans for substance, monospace for signals (kickers, code, API tags).
- Self-contained: no external fonts, scripts, or network calls.

## 2. Colors

A deep blue-tinted slate carrying a single warm accent, gold, with indigo and status hues used sparingly as secondary signals.

### Primary
- **Window Gold** (`oklch(0.84 0.135 79)`): The light inside. Primary buttons, the brand mark, the kicker dot, active states, focus rings, hover glows, and every "this is the important thing" moment. Its warmth is the brand.
- **Gold Deep** (`oklch(0.78 0.14 66)`): The second stop of every gold gradient (mark, primary button, user message bubble). Never used flat on its own.
- **Gold Ink** (`oklch(0.9 0.11 82)`): Gold as *text*, a lighter, legible tint for kicker labels, links, and accent headings on dark surfaces.

### Secondary
- **Signal Indigo** (`oklch(0.7 0.15 274)`): The cool counter-light bleeding in from the top-right. Ambient background wash and the occasional secondary accent. Never competes with gold for a call to action.

### Tertiary
- **OK Green** (`oklch(0.8 0.14 155)`): Success, connected, enabled capability. Paired with a soft glow on status dots.
- **Alert Red** (`oklch(0.72 0.16 25)`): Errors and failed states only.

### Neutral
- **Vault Slate** (`oklch(0.145 0.02 265)`): The ground. Page background, the dark room.
- **Slate Raised** (`oklch(0.185 0.022 265)`): One step up. Cards, inputs, panels, the raised surfaces that hold content.
- **Slate Raised 2** (`oklch(0.22 0.024 265)`): Two steps up. Hover fills, dropdown menus, the interior of the window mock.
- **Ink** (`oklch(0.97 0.008 265)`): Primary text and headings.
- **Dim** (`oklch(0.72 0.018 265)`): Body copy, secondary text, nav links at rest.
- **Faint** (`oklch(0.58 0.016 265)`): Captions, metadata, model IDs, placeholder text.
- **Hairline** (`oklch(1 0 0 / 0.09)`): Every border, divider, and grid line. A whisper of white, never a hard rule.

### Named Rules
**The One Warm Signal Rule.** Gold is the only warm hue on the screen, and it stays rare. It marks the primary action, the brand, and the single live accent, not decoration. If two gold things compete for attention in one view, one of them is wrong.

**The Tinted Neutral Rule.** There is no pure black and no pure white. Every neutral is tinted toward the blue-slate hue (265) at low chroma. `#000` and `#fff` are forbidden.

## 3. Typography

**Display / Body Font:** system-ui (with -apple-system, Segoe UI, Roboto, Helvetica, sans-serif)
**Label / Mono Font:** ui-monospace (with SF Mono, JetBrains Mono, Menlo, Consolas, monospace)

**Character:** One workhorse sans carries everything from hero to body; monospace is reserved for machine voice. The pairing is intentional and dependency-free: no web fonts are loaded, so the interface renders instantly and privately in the user's own system typeface.

### Hierarchy
- **Display** (800, `clamp(2.6rem, 6.4vw, 4.7rem)`, line-height 1.02, letter-spacing -0.035em): Hero and page headlines. Heavy weight and tight tracking; often uses a gold-ink emphasis word.
- **Headline** (700, `clamp(1.5rem, 2.5vw, 1.9rem)`, -0.02em): Section headings.
- **Title** (650, `1.12rem`, -0.01em): Card and subsection titles.
- **Body** (400, `1rem`, line-height 1.6): Prose, in Dim. Cap measure at 60–75ch.
- **Label / Kicker** (mono, 500, `0.78rem`, letter-spacing 0.02em, sometimes uppercase 0.14em): The signal voice. Kickers, eyebrows, code, API-surface tags, model IDs, status. Always monospace, usually Gold Ink or Faint.

### Named Rules
**The Machine-Voice Rule.** Monospace means "this is literal machinery": a code snippet, an API call, a kicker, an identifier. Never set prose or a heading in mono; never set an API name in the sans.

**The Gold Emphasis Rule.** Emphasis inside a heading is one word recolored to Gold Ink, not italic, not underline, and never a gradient across the text.

## 4. Elevation

Flat at rest, light on interaction. Surfaces sit flat, distinguished only by a one-step tonal lift and a Hairline border. Depth is a *response*: on hover a card rises a few pixels and picks up a warm gold-tinted glow; on focus an input gains a gold ring. Only genuinely floating things, the browser-window mock, dropdown menus, carry a real drop shadow at rest, because they are literally above the page.

### Shadow Vocabulary
- **Gold hover glow** (`box-shadow: 0 24px 50px -28px oklch(0 0 0 / 0.85), 0 0 44px -24px oklch(0.84 0.135 79 / 0.5)`): Interactive cards and primary buttons on hover. Warmth, not just shadow.
- **Focus ring** (`box-shadow: 0 0 0 3px oklch(0.84 0.135 79 / 0.12)` with a gold-shifted border): Inputs and controls on focus.
- **Floating drop shadow** (`box-shadow: 0 22px 46px -28px oklch(0 0 0 / 0.8)`): The window mock, dropdown menus, popovers. The only shadow present at rest.
- **Mark glow** (`box-shadow: 0 0 0 1px oklch(0.84 0.135 79 / 0.4), 0 6px 20px -8px oklch(0.84 0.135 79 / 0.6)`): The brand mark, so the "W" reads as a lit tile.

### Named Rules
**The Flat-Until-Touched Rule.** A resting surface has a border and a tonal step, never a shadow. Shadows and lift appear only in response to hover, focus, or genuine float. A static drop shadow on a resting card is prohibited.

## 5. Components

### Buttons
- **Shape:** Softly rounded (10px), never pill, never square.
- **Primary:** A gold gradient (`linear-gradient(150deg, Window Gold, Gold Deep)`) with Vault Slate text, padding `0.72rem 1.3rem`, weight 600. It is the one warm object in the view.
- **Hover / Focus:** `translateY(-1px to -2px)` plus the gold hover glow. Ease-out on a `cubic-bezier(0.22,1,0.36,1)` curve; never animate layout properties.
- **Ghost / Secondary:** Transparent-to-faint fill (`oklch(1 0 0 / 0.02–0.04)`), Ink text, Hairline border. Hover brightens the border, no glow. Used for the quieter of two adjacent actions.

### Chips / Tags
- **Style:** Monospace, `0.72–0.76rem`, Hairline border, faint or dim text on a barely-there fill. Used for API-surface tags and capability badges.
- **State:** An active/enabled capability shifts to OK Green text on a green-tinted fill; a gold "signal" tag uses Gold Ink on a gold-tinted fill with a gold-tinted border.

### Cards / Containers
- **Corner Style:** Large radius (16px) for cards and panels, 12px for smaller frames.
- **Background:** Slate Raised, on the Vault Slate ground.
- **Shadow Strategy:** None at rest (see Elevation). Interactive cards lift and glow gold on hover.
- **Border:** 1px Hairline, always.
- **Internal Padding:** Generous and varied (`1.4rem 1.5rem` typical). Vary padding for rhythm; do not pad every surface identically.

### Inputs / Fields
- **Style:** Slate Raised fill, Hairline border, 10px radius, Ink text, Faint placeholder.
- **Focus:** Border shifts to a gold tint (`oklch(0.84 0.135 79 / 0.6)`) with a soft 3px gold ring. No layout shift.

### Navigation
- **Style:** A flat bar over the grid backdrop, brand mark + name on the left, Dim mono-adjacent links on the right, separated by a Hairline underline. Links brighten Dim to Ink on hover. On the app, an "Open vault" gold button anchors the right edge.

### Signature Component: The Window
The brand's defining element, a literal browser window. A chrome bar (three neutral `oklch(1 0 0 / 0.14)` dots, optional mono label) over a framed interior on the Slate-Raised-2 to Vault-Slate gradient, wrapped in a Hairline border with a floating drop shadow. Appears as the landing hero mock (with a streaming caret), the featured demo card's live preview, and, conceptually, in code frames and the demo backdrop. When a surface needs to feel like "the product," give it the window.

## 6. Do's and Don'ts

### Do:
- **Do** keep gold rare and singular: one primary action, one live accent per view (The One Warm Signal Rule).
- **Do** tint every neutral toward the blue-slate hue (265) at low chroma; use OKLCH for all color.
- **Do** set kickers, code, API names, and identifiers in monospace, and prose in the system sans (The Machine-Voice Rule).
- **Do** keep resting surfaces flat with a Hairline border; reveal shadow and lift only on hover, focus, or genuine float (The Flat-Until-Touched Rule).
- **Do** reach for the window motif (chrome bar, grid, warm light) when a surface should feel like the product.
- **Do** vary spacing and card size for rhythm; differentiate cards with numbers, tags, and real copy.
- **Do** keep everything self-contained: system fonts, inline SVG, no third-party requests.

### Don't:
- **Don't** use em dashes in UI copy, or `--`. Use commas, colons, semicolons, periods, or parentheses.
- **Don't** load web fonts, external scripts, or any third-party asset. The interface makes no network calls the product wouldn't.
- **Don't** ship the generic AI-SaaS look: no purple-to-blue hero gradients, no neon-on-black, no glassmorphism as a default surface.
- **Don't** build a wall of identical icon-heading-text cards. Differentiate, feature, and vary.
- **Don't** use `background-clip: text` gradient headings; emphasize with a single Gold Ink word instead (The Gold Emphasis Rule).
- **Don't** use `#000` or `#fff`, or an untinted gray anywhere.
- **Don't** put a colored `border-left`/`border-right` stripe on cards, callouts, or alerts; use a full Hairline border or a tinted fill.
- **Don't** give a resting card a drop shadow, or let a second gold element compete with the primary action.
