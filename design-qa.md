# Design B visual and interaction verification

Source visual truth: `C:/Users/User/Documents/Three ISP App Design Concepts.png` (1536 x 1024), centre Modern Professional concept B.
Implementation: `http://127.0.0.1:4173/`; screenshot `design-b-mobile.jpg`; combined source/implementation comparison `design-comparison.jpg`.
Viewport requested: 393 x 852 CSS pixels. Browser capture returned 378 x 819 image pixels. Centre source screen crop (671,30,374,867) normalized to the same capture dimensions. The original contains phone chrome; this responsive PWA relies on the real phone's browser/OS chrome rather than drawing a fake phone around the app.
State: public home, signed out, standard text size. Also inspected 320 x 740 narrow phone layout.

## Comparison history

1. Initial implementation: heading wrapped; history card and event content sat too low; event registration fell below persistent navigation. Result blocked. Corrected display heading size, hero height, sign-in spacing, event section rhythm and sample-label position.
2. Revised comparison: all main Design B regions align in order and proportion; the event register button is fully visible at the comparison viewport. Source and implementation opened together in `design-comparison.jpg`. No remaining actionable P0/P1/P2 visual differences.

## Required fidelity surfaces

- Typography: serif branding, welcome, history and sign-in hierarchy; sans-serif support text. Single-line welcome at comparison size, safe wrapping on narrow phone. Georgia/system fonts approximate the raster reference; minor typeface differences are P3.
- Spacing/layout: full-width plantation hero, floating white history card, emerald sign-in, event preview and four-item fixed bottom navigation retained. Added quick access below the fold for seven requested services. Persistent navigation stays visible; narrow screens scroll.
- Colours: emerald actions, dark green headings, white cards, pale backgrounds. Labelled sample states and visible keyboard outlines. Optional larger-text control in the menu.
- Image quality/assets: verified official ISP shield and PNG phone icons replace both the earlier invented mark and the different coat of arms in the concept. Plantation image generated for the supplied visual direction, not an exact copy of the reference photograph. Real October 2026 publication cover. Bootstrap Icons for UI controls. The official crest replacement and photo variation are intentional, not undisclosed fidelity claims.
- Copy/content: stale fictional 2025 event in concept replaced by a clearly labelled sample activity with no invented scheduled date. Programme tiers, prices, CPD targets and consultation services explicitly proposed/sample. Actual ISP links remain separate.

## Focused checks

Compared header/crest, hero/title, history card, sign-in and event registration region in the combined image. Header logo differs intentionally as documented. Event button is no longer obstructed by bottom navigation.

## Functional verification

Browser exercised: supplied demo password, dashboard navigation, simulated payment/receipt state, CPD entry (18 to 22), Lifetime selector, sample event registration and confirmation, learning hub/poll/vote, programme interest, basket and simulated checkout, forum post/reply with HTML shown as plain text, consultation request preview, publication bookmark and reader preview. Fresh page clears demo records and re-locks protected views. Console error/warning check returned an empty list.

Independent review exercised all seven views with a mock DOM, input escaping, sign-out reset, no backend submissions, and scoped service-worker cache isolation. Fixed its skip-link, inherited-route validation and dialog-name findings. Client password is a public demo gate, not secure authentication.

Static JavaScript syntax checks passed. Offline installation is implemented with a manifest and scoped service worker; real iOS/Android installation and screen-reader testing were not performed. No claim of formal WCAG conformance.

## Remaining polish / limitations

- P3: exact source typeface and plantation photograph differ.
- Publication reader previews the interaction and links to official library; copyrighted article bodies are not duplicated.
- Event materials/poll are local samples; no configured live Mentimeter event.
- All forms, posts and transactions clear on refresh and are not shared between visitors.

final result: passed
