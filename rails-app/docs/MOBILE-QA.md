# Mobile acceptance — iOS and Android

The target is a mobile-first Rails web app for Safari on iOS and Chrome on Android. It is not a native App Store/Play Store build. Source, runtime, uploads and review evidence remain on drive D.

## Built-in mobile support

- Single-column phone layouts with readable text and large touch controls.
- Text inputs at least 16px to avoid focus zoom on iOS; viewport zoom remains available.
- Viewport safe-area support for notches and the bottom home indicator; dynamic-height layout with a viewport-height fallback.
- Standard file selection for JPG, PNG and WebP pictures, up to 5 MB. No forced camera capture. Unsupported formats such as HEIC require export to a supported format; the editor must explain rejection.
- Discover edits, save/error feedback and link access require no hover gestures.
- Carousel pause, keyboard controls and reduced-motion handling are retained.
- Apple touch icon uses the existing ISP brand asset.

## Verification boundary

Executed on 25 October 2026 in responsive desktop Chromium: public carousel and admin editor at 320, 360, 390 and 430px; editor landscape at 844×390. No horizontal overflow or offscreen fields; editor text inputs were 18px. Browser image selection, live text/image preview, saving, signed-out content/image delivery, menu badges and fixed CTA were verified. Screenshots are in `audit/`. These results are viewport checks only.

Responsive desktop Chromium checks do not reproduce iOS WebKit, mobile keyboards, photo conversion or hardware safe-area insets. Before a public pilot, test on at least one real iPhone and one Android phone:

1. Sign in and out; open the menu and every editable card.
2. Edit with the software keyboard visible, including long descriptions and URLs.
3. Choose a library photo and a camera photo; verify clear format/size errors and retained content on failure.
4. Save, refresh and verify the public slide; confirm only administrators can edit.
5. Check portrait, landscape, text enlargement, screen-reader labels and reduced motion.
6. Check top/bottom safe areas and home-screen shortcut appearance.

Physical iOS/Android testing remains pending; do not describe the responsive review as device certification.

## M7 member-services browser verification — 25 October 2026

Completed in responsive Chromium: native Membership menu/page; consultation enquiry form → confirmation/reference → administrator inbox; publication PDF/cover upload → private preview → description edit → second preview → publish → member library and homepage cover. Signed-out homepage exposed only the generic login invitation; login returned to the library. The book and enquiry used fictional QA content and were removed after verification. The library is empty until an authorised issue is uploaded.

Publication preview: 320/390/430px, no horizontal overflow, all images loaded. Editor: 320/430px and 844×390 landscape, no horizontal overflow; text fields 18px and file inputs 16px. No real iPhone/Android hardware validation was performed. Screenshots: audit/m7-menu.png, m7-enquiry-form.png, m7-publication-preview.png and m7-home-library.png. Full-page captures can place fixed bottom navigation midway down the image; viewport scrolling was tested separately.