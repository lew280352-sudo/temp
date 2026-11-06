# Account UI refinement

The owner reported a taller registration frame and an empty-looking purple panel. Keep the supplied sliding-card reference and purple/lime brand; make both desktop modes occupy the same frame with equal panes. Mobile should flow naturally without a fixed-height scrolling form.

## Design plan, reviewed before implementation

- Palette: paper `#ffffff`, backdrop `#f3f0f7`, ink `#292234`, muted `#6b6177`, purple `#5d32b0`, lime `#d8f68a`. The reference pins the purple gradient; reserve lime for the panel's switch action and product illustration.
- Type: retain Noto Sans Thai for Thai and Inter for Latin, with a 38px desktop product statement, 28px form heading, and 13–14px form copy. Left-align the product explanation and form.
- Considered keeping a 55/45 layout; it preserves the form's extra width but does not answer the owner's request for matching proportions. Use equal halves inside a single 700px desktop frame that shrinks for short viewports.

```text
Login:    [ form, 50%          | product explanation, 50% ]
Register: [ explanation, 50%   | form, 50%                ]
Mobile:   [ form ]
          [ explanation and alternate account action ]
```

Make the product's company-to-source reading path the memorable element: use a compact illustration of supported company tickers leading to original sources, explicitly labelled as examples. It must not resemble a user's saved watchlist, a live quote, or an invented news feed. Explain actual functionality in short feature lines. Remove the redundant third mode-switch link and keep the top mode controls plus panel switch. Preserve recovery, password-manager fields, authentication guards, and service errors.

Review against the brief: replacing the blank panel with generic statistics, testimonials, or floating cards would add unearned content. Use actual supported ticker examples and plain product copy instead. No new backend or service dependency is needed.

## Skills and provenance

- Anthropic [frontend-design](https://github.com/anthropics/skills/tree/ca45fc496a3436251f191354091d557da31c15b5/skills/frontend-design), pinned to `ca45fc496a3436251f191354091d557da31c15b5`. Read the instructions before installation; installed SKILL blob matches `a5333457c414d20d625f307df945842c0952ecc3`.
- Vercel [web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines), pinned to `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`. Installed SKILL blob matches `ceae92ab319216a68274168fba9b63b998b65997`. Its current [interface rules](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) were fetched for this review.

Both repositories were public and unarchived under the named organizations when inspected on 6 November 2026. Local installation uses Codex's Skill Installer and does not add a runtime package.

## Targeted interface review

```text
dist/auth.js:14 - fixed: mode heading can receive focus; email disables spelling/capitalization; password help is associated with its field
dist/index.html:20 - pass: example logos have dimensions and empty alt beside visible ticker labels; examples are labelled
dist/ui-polish.css:62 - fixed: both desktop modes share one frame; long recovery/error content can scroll
dist/ui-polish.css:75 - fixed: keyboard focus uses lime on the purple panel
```

Validation: 63 unit/API tests and the general, responsive, reference, MFA/privacy-race and email-login Playwright suites pass locally. The reference regression failed against the old frame before the fix. It now checks frame equality, equal panes, 1440×768 submit reachability and heading focus, 320px overflow, email retention, dock navigation and reduced motion. Inspected screenshots include desktop registration, tablet login and mobile registration; the examples use existing local Simple Icons assets.
