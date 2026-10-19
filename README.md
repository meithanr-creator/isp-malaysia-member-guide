# ISP Design B member experience demo

A static mobile PWA matching the centre Modern Professional concept in the supplied Three ISP App Design Concepts image. The official ISP shield replaces the fictitious coat of arms shown in that concept.

## Separate demo environment

Source: `meithanr-creator/isp-malaysia-member-guide`, branch `design-b-demo`. Separate Cloudflare Pages project: `isp-design-b-demo`. Production branch for that project: `design-b-demo`; framework None; build command blank; output directory repository root. Existing GitHub Pages `main` remains unchanged.

## Demo scope and data

Seven interactive areas: membership, payment and CPD; event registration, sample materials and poll; proposed certification pathways; shop and simulated checkout; temporary posts and replies; The Planter publication preview; consultation request preview. All entered records live only in JavaScript memory, clear on refresh/sign-out and are never sent to a backend. No analytics or third-party scripts.

The client password is a public prototype gate, not authentication. Never reuse it for a real account. No financial details are requested and payments are simulated. Programme tiers, merchandise, prices, points and events are illustrative, not official offers. External links to ISP/Mentimeter are explicitly marked; opening them uses their own policies.

## Assets and sources

Official crest, PWA PNG icons and October 2026 cover: https://isp.org.my/v4/ (checked 19 October 2026). Bootstrap Icons: MIT, https://github.com/twbs/icons. Plantation photograph generated specifically for this demo from the Design B visual brief. Publication preview does not reproduce magazine articles.

## Local preview

`python -m http.server 4173 --directory .` then open http://127.0.0.1:4173/ . No build or package dependencies are needed.
