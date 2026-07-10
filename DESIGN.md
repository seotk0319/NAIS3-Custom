# NAIS3 Custom Design Contract

## 1. Atmosphere

- Product type: dense desktop production tool.
- Direction: restrained, neutral, utilitarian, and optimized for repeated scanning.
- Preserve the existing NAIS3 visual language. Do not introduce marketing layouts or decorative effects.

## 2. Color

- All component colors must use the semantic tokens declared in `src/renderer/src/assets/main.css`.
- Surfaces: `paper`, `surface`, and `surface-2`.
- Text: `ink`, `muted`, and `faint`.
- Structure: `line`.
- Actions: `accent`, `accent-soft`, and `danger`.
- Existing functional status colors from the current Tailwind components may be reused without adding a new palette.
- No gradients, glows, decorative color blobs, or new raw color literals.

## 3. Typography

- UI font: `var(--font-ui)`, currently Pretendard Variable with the existing system fallbacks.
- Technical values: `var(--font-mono)`.
- Keep the existing compact type scale. Toolbars and controls use the established 11px to 14px utilities.
- Letter spacing remains zero. Do not add viewport-scaled typography.

## 4. Spacing

- Reuse existing Tailwind spacing utilities already present in the edited component.
- Compact controls retain the established 32px or 40px heights.
- Toolbars must wrap safely where the current component already supports wrapping.
- Do not add new magic spacing values for these maintenance changes.

## 5. Components

- Use the existing `Button`, `Slider`, tooltip, toast, and Lucide icon components.
- Standard controls use the existing `rounded-md` shape and semantic border/surface tokens.
- Preserve hover, focus, disabled, loading, empty, and error states.
- Labels and tooltips must describe the real operation and real batch count.

## 6. Motion

- This maintenance scope adds no motion.
- Preserve existing transitions. New motion may use only transform or opacity and must respect reduced motion.

## 7. Depth

- Reuse the existing border and shadow utilities already established by each component.
- Do not add new elevation levels, glass effects, or nested decorative cards.
