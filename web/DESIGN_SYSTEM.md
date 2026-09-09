# Design System

Built on [shadcn/ui](https://ui.shadcn.com) (`base-nova` style, Base UI primitives) + Tailwind v4. All tokens live in `app/globals.css`; components live in `components/ui/`.

## Principles

1. **Never hardcode colors.** Always use a token (`bg-primary`, `text-muted-foreground`, `bg-success-muted`) — never a raw hex/oklch value in component code. If a needed color doesn't exist as a token, add it to `globals.css`, don't inline it.
2. **Compose, don't fork.** Extend `components/ui/*` primitives with new variants (see `status-badge.tsx`) instead of writing one-off styled elements for the same concept elsewhere.
3. **Status has one vocabulary.** Any pass/fail/risk/severity state in the product renders through `StatusBadge` (`components/ui/status-badge.tsx`) and the `runStatusMap` / `riskLevelMap` lookups — not ad hoc `text-red-500` style strings.

## Color tokens

Base shadcn tokens (background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring/sidebar/chart-1..5) are standard — see `globals.css`.

Brand primary is indigo/violet (`oklch(0.51 0.19 264)` light / `oklch(0.7 0.16 264)` dark).

### Semantic status (added on top of shadcn defaults)

| Token | Use for |
|---|---|
| `success` / `success-foreground` / `success-muted` | Passed test runs, low risk, green states |
| `warning` / `warning-foreground` / `warning-muted` | Flaky results, medium risk, amber states |
| `danger` / `danger-foreground` / `danger-muted` | Failed test runs, high risk, red states |
| `info` / `info-foreground` / `info-muted` | Neutral findings, informational states, blue |

Use the `-muted` variant for badge/chip backgrounds (subtle fill + solid text), the bare token for solid fills (button/icon color on a light background), and `-foreground` for text placed on a solid fill of that color.

```tsx
import { StatusBadge, runStatusMap, riskLevelMap } from "@/components/ui/status-badge"

<StatusBadge status={runStatusMap[run.result]}>{run.result}</StatusBadge>
<StatusBadge status={riskLevelMap[finding.risk]}>{finding.risk} risk</StatusBadge>
```

## Typography

- Sans: Geist (`--font-sans` / `font-sans`, default on `html`)
- Mono: Geist Mono (`--font-mono` / `font-mono`) — use for SHAs, branch names, file paths, trace/log output.
- Scale: default Tailwind text scale (`text-xs` → `text-3xl`). Don't introduce custom font sizes outside the scale.

## Radius

Use the generated scale, never a raw `rounded-[Npx]`: `rounded-sm` → `rounded-4xl`, derived from `--radius` (0.625rem base). Badges/pills use `rounded-4xl`; cards/inputs use `rounded-lg`.

## Components available

Installed via `npx shadcn@latest add <name>`: `button`, `badge`, `status-badge` (custom), `card`, `separator`, `tabs`, `table`, `dropdown-menu`, `dialog`, `input`, `label`, `tooltip`, `skeleton`, `avatar`, `scroll-area`, `sonner` (toasts).

Add more with `npx shadcn@latest add <component>` — never hand-roll a component that shadcn already provides (checkbox, select, form, etc.) unless it's been added and doesn't fit.

## Dark mode

All tokens are dual-defined in `:root` and `.dark` in `globals.css`. Toggle by adding/removing the `.dark` class on `<html>`. Every new token must define both a light and dark value — don't ship a light-only or dark-only color.

## Icons

`lucide-react` (configured as the icon library in `components.json`). Use `size-4` (16px) inline in buttons/badges, `size-5` standalone.
