# Tailwind CSS Styling Rules

This document outlines the standard styling patterns and rules for using Tailwind CSS in this project. Following these rules ensures visual consistency and prevents common UI regressions.

## 1. Focus State Management

**Rule**: Always remove the default browser focus ring and avoid generic Tailwind focus utility classes that produce high-contrast outlines (like `focus:ring-2`).

- **Usage**: Use `focus:outline-none` or `focus-visible:outline-none` on focusable elements (inputs, buttons, links).
- **Custom Indicators**: When a focus state is visually required, implement it using subtle design system tokens (e.g., `transition-shadow`, `border-primary/20`) rather than the default ring.
- **Canvas Elements**: In the canvas workspace, use selection-based markers (like blue box shadows) instead of focus rings.
- **Implementation**: Prefer `outline-none!` if overriding strict global styles, or standard `focus:outline-none` for component-level control.

## 2. Color Palette & Semantic Tokens

Always prefer semantic color variables defined in the theme over arbitrary hex codes or default Tailwind colors.

### Theme Variables (@theme)

Defined in `src/renderer/assets/base.css`:

- `--color-primary`: Main accent color (#F5AFAF - Pink).
- `--color-surface-50` to `--color-surface-300`: Neutral pinkish-white surface shades.

### CSS Variables (:root)

- `--ev-c-text-1`: Primary text (Black).
- `--ev-c-text-2`: Secondary text (70% Opacity).
- `--ev-c-text-3`: Muted/Placeholder text (40% Opacity).

## 3. Layout & Component UI

- **Responsive Design**: Use mobile-first breakpoints (`sm:`, `md:`, `lg:`).
- **Borders**: Standardize on `border-surface-200` for soft borders in cards and containers.
- **Backgrounds**: Use `bg-surface-50` for page backgrounds and `bg-white` or `bg-surface-100` for interactive cards.
- **Tailwind v4 Integration**: Be mindful of Tailwind v4 syntax (e.g., `shrink-0` instead of `flex-shrink-0`, and modern variable mapping).

## 4. Typography

- **Font Family**: Primary font is **Inter** with system fallbacks.
- **Sizing Hierarchy**:
  - `text-xs`: Metadata, labels, and small UI details.
  - `text-sm`: Standard content and input placeholders.
  - `text-base`: Primary text and body content.
  - `text-lg`/`text-xl`: Core section headings.

## 5. Checklist for New Components

- [ ] Does it have `focus:outline-none` on all focusable elements?
- [ ] Are colors mapped to `--color-surface-*` or `--color-primary`?
- [ ] Is it responsive across `sm` and `md` breakpoints?
- [ ] Are text colors using `--ev-c-text-*` variables for better contrast control?
