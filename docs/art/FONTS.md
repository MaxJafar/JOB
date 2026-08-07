# J.O.B. font choices

Recommended production faces:

- **Display:** Archivo Black, SIL Open Font License 1.1. Use for the J.O.B.
  wordmark, menu headlines, stamps, and large combo numerals.
- **Body / ledger:** IBM Plex Mono, SIL Open Font License 1.1. Use for
  timers, currency, stats, key prompts, and compact system labels.

The current deterministic asset export uses installed Windows fallbacks when
the font files are not present: Bahnschrift/Arial Black for display and
Consolas for ledger text. The runtime CSS keeps the same order of preference:

```css
--font-display: "Archivo Black", "Bahnschrift", "Arial Black", Impact, sans-serif;
--font: "IBM Plex Mono", "Cascadia Mono", Consolas, monospace;
```

Before shipping, place the approved OFL font files in a project-owned font
directory, record the exact version and license text, and update the fallback
chain. Do not rely on a remote font request in Steam builds.
