# CodeBook

AI coding CLI management desktop + mobile app built with Tauri v2 + React + React Native.

## Design Context

### Users
Developers who use AI coding CLIs (Claude Code, Codex) daily. They work across desktop and mobile — desktop for active coding sessions, mobile for monitoring, reviewing, and quick remote interactions. They value efficiency, want full visibility into what the AI is doing, and expect professional-grade tooling that respects their workflow.

### Brand Personality
**Warm, Capable, Crafted** — Premium but approachable. Not cold enterprise software, not a toy. Every detail should feel intentional, like a well-made instrument. The warmth comes from the amber accent palette and thoughtful micro-interactions, the capability from deep AI/Git integration, the craft from pixel-perfect execution.

### Emotional Goals
- **In control & confident** — Users always know what's happening with their AI tools and code
- **Calm & focused** — Distractions stripped away, clean information hierarchy
- **Delighted & impressed** — Moments of "this is better than I expected"

### Aesthetic Direction
- **References**: Cursor IDE (AI-native feel, seamless), Arc Browser (opinionated, premium, innovative)
- **Anti-references**: Electron bloat (Slack/Teams heaviness), dashboard overload (too many widgets), generic SaaS (rounded-card Notion clones), terminal nostalgia (CLI aesthetics over usability)
- **Theme**: Dark-first with warm undertones. Two themes: "Codebook Warm" (default, amber-tinted darks) and "Anysphere Dark" (cooler, Cursor-inspired)

### Design Principles

1. **Information density without clutter** — Show what matters at the right time. Use progressive disclosure. A 3-panel layout should feel spacious, not cramped. Collapse gracefully.

2. **Monospace is the medium** — JetBrains Mono is the soul of the UI. Code, labels, status text — all mono. This isn't a marketing site, it's a developer's workspace. But use Inter on mobile for readability at small sizes.

3. **Amber as signal, not decoration** — The `#E5A54B` accent marks what's active, actionable, or important. It should never be used for mere decoration. When amber appears, it means something.

4. **Native speed, native feel** — Tauri not Electron. 44px header, macOS traffic lights, col-resize handles, system-level scrollbars. It should feel like it belongs on the OS, not in a browser tab.

5. **Desktop and mobile are one product** — Same data, real-time sync, shared design language. Mobile isn't a companion app — it's the same tool in your pocket. Consistency in patterns, adapted for the form factor.

### Color System
```
Backgrounds:  #1C1917 → #262220 → #33302A (warm dark scale)
Text:         #E8E4E0 → #C8C4BE → #9C9690 → #6B6560 (4-level hierarchy)
Borders:      #2A2520 (default), #E5A54B (active)
Accent:       #E5A54B (amber), #4ADE80 (green), #EF4444 (red), #60A5FA (blue), #A78BFA (purple)
```

### Typography
- Desktop: JetBrains Mono 400-700, base 13px, line-height 1.6
- Mobile: Inter 400-700, base 14-15px
- Scale: 10 / 11 / 12 / 13 / 14 / 16 / 20px

### Spacing
- Base unit: 4px
- Common: 4, 6, 8, 10, 12, 14, 16, 20, 24, 32px
- Panel padding: 16-24px
- Component gap: 6-12px
- Border radius: 4-6px (controls), 8-10px (panels), 20px (pills)

### Component Patterns
- **Tabs**: Pill-style with filled background on active (not underline)
- **Buttons**: Outlined default, amber-filled for primary CTA, ghost for tertiary
- **Inputs**: Dark elevated background, subtle border, no visible focus ring — border color change only
- **Icons**: Lucide React, 11-15px, color indicates state not decoration
- **Checkboxes**: Base UI components, status-colored when checked
