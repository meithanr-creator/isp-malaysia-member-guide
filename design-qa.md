# Design QA · approved three-screen build · 20 October 2026

final result: passed

## Source and implementation evidence
- Visual truth: D:\Projects\isp-member-demo\mockups-2026-10-20\01-welcome.png, 02-membership-dashboard.png, 03-event-registration.png.
- Browser implementation: http://127.0.0.1:4174/ at 390 × 844 CSS pixels, standard text.
- Source: 853 × 1844 pixels. Browser screenshot: 375 × 812 pixels (browser capture scaling); each side normalized to 390 × 844 for comparison. Source has no device bezel or status bar.
- Full-view evidence: audit-2026-10-20/welcome-comparison.jpg, dashboard-comparison.jpg, event-comparison.jpg. Source is left; actual browser-rendered app is right. These combined images were opened and inspected.
- Focused evidence: audit-2026-10-20/header-focus.jpg and registration-focus.jpg, opened and inspected for logo, type, input labels, borders and buttons.
- Actual app board: audit-2026-10-20/built-three-screens.jpg. Screenshots exported from this task's actual browser results, not reconstructed from code.
- States: home (signed-in CTA changes to Member dashboard); dashboard fresh Member/18 CPD; leadership event with Registration tab selected and Alex Tan sample name.
- Additional evidence: audit-2026-10-20/narrow-large-text.jpg, 320 × 740 CSS viewport, larger text; no horizontal overflow. Desktop at 1440 × 1000: contained 480px app, no horizontal overflow.

## Comparison history
1. Initial build: blocked. P1 legacy welcome style was replaced with the selected editorial photo-strip layout; P2 headline wrapped into three lines; P2 member summary was too tall and moved reading below the intended region; P2 event form spacing hid the essentials.
2. Corrected welcome heading size/tracking, story/event spacing, member facts spacing and action-row rhythm; reduced event metadata/form gaps and placed essentials above the persistent navigation.
3. Recaptured all three states and compared normalized source/live images together. No remaining actionable P0/P1/P2 design differences. Final dashboard recapture excludes the transient login toast.

## Required fidelity surfaces
- Fonts/typography: local Newsreader display serif and Source Sans 3 body font; two-line welcome/event titles match the intended hierarchy. Body/action text is slightly larger than the raster reference in places for readability. Native browser antialiasing and font rendering differ from generated raster text.
- Spacing/layout: approved header/photo/content/action/nav sequence retained. Sage member summary, CPD strip, three navigation rows and reading block match the selected composition. Event form is a page, not a modal. All core controls remain accessible when the page scrolls.
- Colours/tokens: warm white, forest text, emerald actions, sage membership slab, fine grey rules; no legacy floating history card or decorative gradients.
- Imagery/assets: exact approved photo-only crops, correct original ISP shield (official green intentionally differs from generated dark-green tracing), Bootstrap icons, official October 2026 publication cover instead of invented mock cover.
- Copy/content: approved welcome and registration copy retained. Intentional changes: ISP Academy label, actual official publication, sample venue wording, signed-in CTA. Jobs is an additional requested area, not inserted into the approved dashboard composition.
- Accessibility: labelled native inputs, visible keyboard focus, dialog semantics, skip link, text-size control, keyboard-operable event tabs, no horizontal overflow at tested enlarged narrow viewport. No claim of full WCAG certification or real-device screen-reader validation.

## Primary interactions tested
All eight areas: Member/Lifetime, simulated payment, CPD addition; event registration/materials/poll; Academy interest including Palm Oil University; basket/checkout; forum post/reply; publication bookmark/reader; consultation preview; Jobs filters, mock JD and local vacancy creation. Markup-like text in a vacancy JD renders as text. Console error check returned none in tested flows. JavaScript syntax checks passed.

## Accepted differences / P3 follow-up
- Minor font metrics, spacing and standard-library icon silhouettes differ from the generated raster; composition and primary affordances are retained.
- Official crest is lighter green than the generated mockup. Do not recolour or redraw the brand to imitate a synthetic mark.
- Real publication cover is intentionally different. Academy wording is explicitly user-requested.
- Native select controls and scrollbar vary by browser. Small supporting labels remain secondary; large-text mode increases legibility.

## Implementation checklist
- [x] Approved three screens implemented and compared as paired evidence.
- [x] Eight demo areas, no backend submissions.
- [x] Local fonts/assets and v3 PWA shell.
- [x] Narrow enlarged text and desktop containment checked.
- [x] Separate design-b-demo branch / isp-design-b-demo Pages project only.
- [ ] Real iPhone/Android home-screen installation and offline use should be checked on physical devices; browser asset checks are not a substitute.
