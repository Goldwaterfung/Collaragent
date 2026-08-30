# CollarAgent UI Design System

## Overview

CollarAgent is a desktop application with a modern, minimalist design featuring a three-column layout with resizable panels. The design system uses a soft rose-pink palette with indigo accents, built on Tailwind CSS v4 with custom design tokens.

### Design Philosophy

- **Light & Minimalist**: Clean, spacious interfaces with soft backgrounds
- **Functional Over Decorative**: Every element serves a clear purpose
- **Responsive**: Fluid layouts that adapt to user preferences (resizable panels)
- **Accessible**: High contrast text with clear visual hierarchy

---

## Color System

### Primary Palette

| Token                 | Value     | Usage                              |
| --------------------- | --------- | ---------------------------------- |
| `--color-surface-50`  | `#FCF8F8` | Primary background                 |
| `--color-surface-100` | `#FBEFEF` | Soft backgrounds, secondary panels |
| `--color-surface-200` | `#F9DFDF` | Borders, muted backgrounds         |
| `--color-surface-300` | `#F5AFAF` | Primary accent, buttons            |

### Accent Colors

| Token                 | Value                      | Usage                                       |
| --------------------- | -------------------------- | ------------------------------------------- |
| `--color-primary`     | `#F5AFAF`                  | Primary actions, active states, dividers    |
| `--color-accent`      | `#818cf8`                  | Secondary highlights, subagent cards, links |
| `--color-accent-glow` | `rgba(129, 140, 248, 0.4)` | Glow effects                                |

### Text Colors

| Token           | Value                | Usage                                 |
| --------------- | -------------------- | ------------------------------------- |
| `--ev-c-text-1` | `#000000`            | Primary text, headings                |
| `--ev-c-text-2` | `rgba(0, 0, 0, 0.7)` | Secondary text, body content          |
| `--ev-c-text-3` | `rgba(0, 0, 0, 0.4)` | Tertiary text, placeholders, disabled |

### Semantic Mappings

```css
--color-background: var(--color-surface-50);
--color-background-soft: var(--color-surface-100);
--color-background-mute: var(--color-surface-200);
--color-text: var(--ev-c-text-1);
```

### Color Usage Guidelines

1. **Backgrounds**: Use `surface-50` for main backgrounds, `surface-100` for panels, `surface-200` for cards/inputs
2. **Borders**: Always use `surface-200` for subtle separation
3. **Primary Actions**: Use `primary` (surface-300) for main buttons, active states
4. **Highlights**: Use `accent` (indigo) for links, badges, and subagent-related content
5. **Hover States**: Combine `surface-200` background with `primary` border for interactive elements

---

## Typography

### Font Stack

```css
font-family:
  Inter,
  -apple-system,
  BlinkMacSystemFont,
  'Segoe UI',
  Roboto,
  Oxygen,
  Ubuntu,
  Cantarell,
  'Fira Sans',
  'Droid Sans',
  'Helvetica Neue',
  sans-serif;
```

### Text Scale

| Class       | Size | Usage                         |
| ----------- | ---- | ----------------------------- |
| `text-4xl`  | 36px | Page titles, hero headings    |
| `text-2xl`  | 24px | Section titles, modal headers |
| `text-xl`   | 20px | Card titles, panel headings   |
| `text-lg`   | 18px | Subheadings, important labels |
| `text-base` | 16px | Body text, default size       |
| `text-sm`   | 14px | Secondary text, labels        |
| `text-xs`   | 12px | Meta information, timestamps  |

### Font Weights

| Class            | Weight | Usage                        |
| ---------------- | ------ | ---------------------------- |
| `font-extrabold` | 800    | Emphasized headings          |
| `font-bold`      | 700    | Primary headings             |
| `font-semibold`  | 600    | Subheadings, emphasized text |
| `font-medium`    | 500    | Labels, important content    |
| `font-normal`    | 400    | Body text, default           |

### Special Typography

- **Monospace**: `font-mono` for code, technical content, file paths
- **Tracking**: Use `tracking-tight` for headings, `tracking-wide` for labels
- **Line Height**: Base `1.6` for body text

---

## Spacing & Layout

### Border Radius

| Token         | Value | Usage                  |
| ------------- | ----- | ---------------------- |
| `--radius-sm` | 4px   | Small elements, badges |
| `--radius-md` | 8px   | Buttons, inputs        |
| `--radius-lg` | 12px  | Cards, panels          |
| `--radius-xl` | 16px  | Large cards, modals    |

### Spacing Scale

- **Compact**: `p-1`, `p-2`, `px-1.5`, `py-0.5` - Dense UI, icons
- **Standard**: `p-3`, `px-3 py-2`, `p-4` - Default spacing
- **Generous**: `p-6`, `px-4 sm:px-6` - Modal content, sections
- **Gap**: `gap-1`, `gap-2`, `gap-3`, `gap-4` - Element spacing

### Layout System

#### Flexbox Patterns

**Vertical Stack:**

```tsx
<div className="flex flex-col h-full">
  <div className="shrink-0">Header</div>
  <div className="flex-1 overflow-hidden">Content</div>
</div>
```

**Horizontal Toolbar:**

```tsx
<div className="flex items-center justify-between p-3">
  <div className="flex items-center gap-2">Left actions</div>
  <div className="flex items-center gap-1">Right actions</div>
</div>
```

**Expandable Content:**

```tsx
<div className="flex flex-col">
  <div className="flex items-center justify-between cursor-pointer">Header</div>
  {isExpanded && <div className="animate-in fade-in">Content</div>}
</div>
```

#### Grid Patterns

**Responsive Cards:**

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-6">{/* Cards */}</div>
```

### App Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│ TitleBar (h-9)                                          │
├─────────────┬───────────────────────────┬───────────────┤
│ Sidebar     │ Workspace (flex-1)        │ Chat Panel    │
│ (240px)     │                           │ (400px)       │
│             │                           │               │
│ InstanceMgr │ WelcomeScreen/Workspace   │ ChatContainer │
│ SkillsPanel │                           │               │
└─────────────┴───────────────────────────┴───────────────┘
```

**Width Constraints:**

- Sidebar: 150px - 500px
- Chat Panel: 300px - min(800px, 60% window width)
- Workspace: Remaining flexible space

---

## Component Architecture

### Component Organization

```
src/renderer/components/
├── Layout/         - App-level elements (TitleBar, ProgressBar)
├── Chat/           - Chat interface (21 components)
├── Workspace/      - Workspace management (4 components)
├── Management/     - Instance/project tree
├── Settings/       - Configuration (8 components)
├── Welcome/        - Onboarding screen
└── Utilities/      - Shared components (Divider)
```

### Naming Conventions

| Pattern            | Examples                             | Usage                |
| ------------------ | ------------------------------------ | -------------------- |
| PascalCase         | `MessageList`, `ToolCallCard`        | All React components |
| `Card` suffix      | `GenericToolCard`, `WorkspaceCard`   | Display cards        |
| `Modal` suffix     | `CreateSkillModal`, `SettingsModal`  | Modal dialogs        |
| `Pane` suffix      | `SubagentStreamPane`                 | Dedicated panels     |
| `Container` suffix | `ChatContainer`, `ProgressContainer` | Wrapping containers  |

---

## Design Patterns

### Card Pattern

```tsx
<div className="bg-white/50 border border-surface-200 rounded-xl overflow-hidden hover:shadow-md transition-all">
  <div className="flex items-center justify-between p-3 cursor-pointer">
    <div className="flex items-center gap-3">
      {/* Icon */}
      <span className="font-medium">Title</span>
    </div>
    <div>{ExpandIcon}</div>
  </div>
  {isExpanded && <div className="px-3 pb-3 animate-in fade-in">{/* Content */}</div>}
</div>
```

**Variants:**

- Generic card: Neutral styling
- Tool card: Specialized icons and content
- Subagent card: Purple theme with status badges
- Action card: Larger with hover effects

### Modal Pattern

```tsx
<div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
  <div className="bg-surface-50 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col">
    <div className="flex items-center justify-between p-4 border-b border-surface-200">
      <h3 className="text-xl font-semibold">Title</h3>
      <button onClick={onClose} className="p-1 hover:bg-surface-200 rounded">
        <CloseIcon />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto">{Content}</div>
  </div>
</div>
```

**Sizes:**

- Small: `max-w-sm`
- Medium: `max-w-2xl` (default)
- Large: `max-w-4xl`
- Full screen: `w-full h-full`

### Button Patterns

**Primary Button:**

```tsx
<button className="px-4 py-2 bg-primary hover:bg-primary/90 text-black rounded-lg transition-colors">
  Action
</button>
```

**Secondary Button:**

```tsx
<button className="px-4 py-2 bg-surface-300 hover:bg-surface-200 text-black rounded-lg transition-colors">
  Cancel
</button>
```

**Icon Button:**

```tsx
<button className="p-1.5 hover:bg-surface-200 rounded-md transition-colors">
  <Icon width={16} height={16} />
</button>
```

### Input Pattern

```tsx
<input
  type="text"
  className="w-full p-3 border border-surface-200 rounded-xl bg-surface-50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
  placeholder="Placeholder text"
/>
```

### Toolbar Pattern

```tsx
<div className="flex items-center justify-between p-3 border-b border-surface-200 bg-surface-50/80 backdrop-blur-sm">
  <div className="flex items-center gap-2">
    <h2 className="font-semibold">Title</h2>
  </div>
  <div className="flex items-center gap-1">
    {actions.map((action) => (
      <button key={action} className="p-1.5 hover:bg-surface-200 rounded-md">
        {icon}
      </button>
    ))}
  </div>
</div>
```

---

## Interactive States

### Hover States

**Button Hover:**

```tsx
className = 'hover:bg-surface-200 transition-colors'
```

**Card Hover:**

```tsx
className =
  'hover:shadow-lg hover:border-primary hover:shadow-[var(--color-primary)]/10 transition-all duration-300'
```

**Icon Hover:**

```tsx
className = 'group-hover:scale-110 transition-transform duration-300'
```

### Active/Selected States

```tsx
className={isSelected
  ? 'bg-surface-200 font-medium border-l-2 border-primary'
  : 'hover:bg-surface-100 border-l-2 border-transparent'
}
```

### Disabled States

```tsx
disabled = { isDisabled }
className = 'disabled:opacity-50 disabled:cursor-not-allowed transition-all'
```

### Loading States

```tsx
{
  isLoading && (
    <div className="absolute inset-0 bg-surface-50/60 backdrop-blur-sm flex items-center justify-center">
      <LoadingIcon className="animate-spin" />
    </div>
  )
}
```

---

## Animations

### Animation Utilities

```tsx
// Fade in with zoom
className = 'animate-in fade-in zoom-in-95 duration-200'

// Slide from top
className = 'animate-in fade-in slide-in-from-top-4 duration-500'

// Slide from right
className = 'animate-in fade-in slide-in-from-right-4 duration-300'

// With delay
className = 'animate-in fade-in zoom-in-95 duration-500 delay-150'
```

### Common Animations

| Use Case     | Classes                                              |
| ------------ | ---------------------------------------------------- |
| Modal open   | `fade-in zoom-in-95 duration-200`                    |
| Panel expand | `fade-in slide-in-from-top-2 duration-200`           |
| Welcome card | `fade-in slide-in-from-top-4 duration-500 delay-150` |
| Content load | `fade-in duration-300`                               |

### Transitions

```tsx
// Smooth all properties
className = 'transition-all duration-200'

// Color transitions only
className = 'transition-colors duration-200'

// Transform transitions only
className = 'transition-transform duration-300'
```

---

## Third-Party Integrations

### Dockview

**Custom Theme:**

```css
.dockview-theme-custom {
  --dv-background-color: var(--color-surface-50);
  --dv-tabs-and-actions-container-background-color: var(--color-surface-100);
  --dv-activegroup-visiblepanel-tab-background-color: var(--color-surface-50);
  --dv-active-sash-color: var(--color-primary);
  --dv-font-family: inherit;
}
```

**Usage:**

- Tabbed workspace interface
- Split panels with drag-and-drop
- Resizable sections

---

## Best Practices

### Do's

1. **Use surface colors consistently**: Backgrounds, borders, and cards should use the surface palette
2. **Provide clear visual feedback**: Hover states, active states, and loading indicators
3. **Maintain proper spacing**: Use the established spacing scale (p-3, p-4, gap-2, gap-3)
4. **Use rounded corners consistently**: `rounded-lg` for inputs, `rounded-xl` for cards, `rounded-2xl` for modals
5. **Support text truncation**: Use `truncate` and `max-w-*` for long content
6. **Handle overflow properly**: Use `overflow-hidden` containers with inner scrollable areas
7. **Use semantic colors**: Text hierarchy with `ev-c-text-1/2/3`

### Don'ts

1. **Don't use hard-coded colors**: Always use design tokens
2. **Don't ignore hover states**: Interactive elements need feedback
3. **Don't use arbitrary spacing**: Follow the spacing scale
4. **Don't forget accessibility**: Ensure proper contrast and keyboard navigation
5. **Don't mix patterns**: Follow established component patterns

### Performance

1. **Use Tailwind JIT**: Tailwind v4 compiles only used classes
2. **Minimize custom CSS**: Prefer Tailwind utilities
3. **Use `shrink-0` for fixed elements**: Prevent flex children from shrinking
4. **Use `overflow-hidden` carefully**: Prevent unnecessary layout recalculations

### Accessibility

1. **Color contrast**: Ensure text meets WCAG AA standards
2. **Keyboard navigation**: All interactive elements should be keyboard-accessible
3. **Focus states**: Use `focus:ring-2 focus:ring-primary/50` for visible focus
4. **ARIA labels**: Add appropriate labels for icons and buttons without text
5. **Semantic HTML**: Use proper elements (button, input, nav, etc.)

---

## Icon System

### Usage Pattern

```tsx
import { PlusIcon } from './assets/icons'

;<PlusIcon width={16} height={16} className="text-current" />
```

### Icon Sizes

| Width/Height | Usage                     |
| ------------ | ------------------------- |
| 12px - 14px  | Small icons, dense UI     |
| 16px - 18px  | Default size, buttons     |
| 20px - 24px  | Larger icons, headings    |
| 32px+        | Hero icons, illustrations |

### Icon Colors

- Default: `text-current` (inherits text color)
- Primary: `text-primary` (rose-pink)
- Accent: `text-accent` (indigo)
- Secondary: `text-[var(--ev-c-text-2)]`
- Muted: `text-[var(--ev-c-text-3)]`

---

## Code Examples

### Complete Card Component

```tsx
interface CardProps {
  icon: React.ReactNode
  title: string
  content?: React.ReactNode
  defaultExpanded?: boolean
}

export function Card({ icon, title, content, defaultExpanded = false }: CardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="bg-white/50 border border-surface-200 rounded-xl overflow-hidden hover:shadow-md transition-all">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-surface-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="text-primary">{icon}</div>
          <span className="font-medium text-[var(--ev-c-text-1)]">{title}</span>
        </div>
        <ChevronDownIcon
          width={16}
          height={16}
          className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </div>
      {isExpanded && (
        <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-2 duration-200">
          {content}
        </div>
      )}
    </div>
  )
}
```

### Complete Modal Component

```tsx
interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'full'
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    full: 'w-full h-full'
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className={`bg-surface-50 ${sizeClasses[size]} rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200`}
      >
        <div className="flex items-center justify-between p-4 border-b border-surface-200 shrink-0">
          <h3 className="text-xl font-semibold text-[var(--ev-c-text-1)]">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-200 rounded-md transition-colors"
            aria-label="Close"
          >
            <CloseIcon width={20} height={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
```

---

## Resources

### File Structure

- `src/renderer/assets/base.css` - Global styles and design tokens
- `src/renderer/App.tsx` - Main layout structure
- `src/renderer/components/` - Component library
- `src/renderer/components/Chat/chat.css` - Chat-specific markdown styling

### Key Tools

- **Tailwind CSS v4**: Utility-first styling
- **Dockview**: Tabbed workspace panels
- **React**: Component framework
- **Zustand**: State management (chat store)
- **Electron**: Desktop application framework

### Related Documentation

- Tailwind CSS: https://tailwindcss.com
- Dockview: https://dockview.dev
- React: https://react.dev
