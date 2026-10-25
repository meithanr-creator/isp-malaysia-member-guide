# Lower-cost hosting proposal for planterapp.co

Prepared 25 October 2026. Status: proposal only; no hosting, account, subscription or DNS change has been ordered. The owner confirmed there is no existing ISP server and requested a lower-cost proposal. All development files remain on D.

## Recommended architecture for a small pilot

Use one 8 GB Linux VPS for the Rails application, PostgreSQL, the private ClamAV scanner and the scheduled account-email/expired-preview tasks. Keep publication files and encrypted off-server database backups in private Cloudflare R2 storage. Use a verified SMTP sender for invitations and recovery. The domain stays registered at GoDaddy; connect planterapp.co after staging passes and the owner is ready to change DNS/nameservers.

This reduces the number of separately billed servers. It is a self-managed setup: a named operator must handle operating-system/database/security updates, backup and restore checks, alerts and incidents. Codex can prepare and test deployment scripts during authorized work; that does not provide a permanently staffed operations service. One VPS has no automatic failover; an outage affects both the application and database until recovery. Keep staging isolated with synthetic data, separate secrets and storage; use a temporary second instance for rehearsal when needed rather than mixing staging with live data.

Eight GB is a proposed starting size, subject to load and scanner-update tests. ClamAV recommends roughly 3–4 GiB for its standard signature database, so a tiny 512 MB app instance is not a complete hosting budget for this application. [ClamAV requirements](https://docs.clamav.net/), [Docker memory guidance](https://docs.clamav.net/manual/Installing/Docker.html).

## Shortlist and price evidence

Published prices were checked on 25 October 2026. They exclude tax, currency conversion, operational labour and usage above allowances. The shortlist uses advertised prices. The Hostinger quote below was also checked in an unsubmitted public cart; it is not spending approval or a guarantee that the final invoice will remain unchanged.

| Option | Published base price | Important conditions | Assessment |
| --- | --- | --- | --- |
| Hostinger KVM 2, 8 GB RAM / 100 GB disk | US$8.79 per month equivalent promotion; displayed renewal US$14.99 per month for two years | Plans are paid upfront. The verified term options and displayed taxes are recorded below; recheck the final invoice before purchase. Weekly VPS backups are included; application-consistent daily off-server backups still need configuration. | Exact unsubmitted Malaysia-region quote checked below. Avoid adding a new domain or paid control panel. |
| Hetzner CX33, 8 GB RAM / 80 GB disk, Europe | EUR8.49 per month excluding IPv4; provider backup option adds 20% (EUR1.70), for EUR10.19 before IPv4/tax/other services | The public cost-optimized page displayed unavailable stock during this review. Europe also means a longer route for Malaysian members; measure the actual pilot before selection. | Budget alternative only if stock is confirmed. It is not presently a ready-to-order recommendation. |
| OVHcloud VPS-2, 8 GB | From S$10.88 excluding GST per month on the public catalogue | The linked configurator used annual-upfront pricing and explicitly showed VPS-2 unavailable. Region/term can affect the quote; the catalogue headline is not a confirmed Singapore checkout price. | Excluded from immediate selection because availability was not confirmed. |

Sources: [Hostinger plans and upfront-payment terms](https://www.hostinger.com/vps-hosting), [Hetzner current price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [Hetzner plan sizes and availability](https://www.hetzner.com/cloud/cost-optimized/), [Hetzner backup billing](https://docs.hetzner.com/cloud/billing/faq/), [OVHcloud catalogue](https://www.ovhcloud.com/en-sg/vps/). No shopping cart was submitted and no account was created.

## Verified Hostinger quote: Malaysia region

The unsubmitted public KVM 2 cart was checked on 25 October 2026 with Malaysia selected, no paid control panel and the optional US$6/month daily backup add-on unchecked. Weekly provider backups remain included; daily application-consistent off-server backups still need configuration. No account, payment, order or new domain was submitted.

| Commitment | Initial base cost | Displayed tax | Initial total due | Renewal before tax |
| --- | --- | --- | --- | --- |
| 12 months — recommended balance | US$9.99/month equivalent; US$119.88 upfront | US$9.59 | **US$129.47 upfront** | US$16.99/month equivalent for 12 months; US$203.88 upfront |
| 24 months — lowest equivalent rate | US$8.79/month equivalent; US$210.96 upfront | US$16.88 | **US$227.84 upfront** | US$14.99/month equivalent for 24 months; US$359.76 upfront |
| 1 month — short trial commitment | US$13.99 first month | US$1.12 | **US$15.11 initially** | US$24.49 each month |

Recommend the 12-month option only after an isolated technical rehearsal and owner approval: it reduces the initial commitment compared with two years. The monthly option is useful for a short rehearsal, but its ongoing rate is higher. Displayed tax depends on final billing details; these observations are not a guaranteed invoice. Region availability was shown in the cart, not validated by provisioning or measured latency. The cart was left at 12 months for review, without clicking Continue.

## Whole-system planning allowance

For the first candidate, use a **planning envelope of US$15–20 per month equivalent initially, and US$20–25 after the displayed renewal rate**. This is an engineering allowance, not a supplier quote or spending authorization. It assumes a small pilot, modest storage/mail use, no paid control panel, and an existing/low-volume SMTP arrangement. The upfront invoice may cover the full contract term rather than one month. If the confirmed quote exceeds this envelope or requires an unacceptable commitment, return with a revised option before purchase.

| Component | Pilot allowance / treatment |
| --- | --- |
| VPS including private PostgreSQL and scanner | For the recommended annual term: US$9.99/month equivalent initially and US$16.99/month equivalent at renewal, before tax; annual payment is upfront. |
| Private R2 publications plus encrypted off-server backups | Standard storage has 10 GB-month, 1 million Class A and 10 million Class B operations included monthly; egress is free. Above this, standard storage is US$0.015/GB-month plus operations. Reserve US$0–2 initially; actual usage controls the bill. |
| SMTP invitations and recovery | Reserve US$0–5 for modest pilot traffic, **provider/verified-sender quote still required**. This allowance is not a claim that a specific free provider has been selected or that mail works. |
| Backup/monitoring operations | Daily database exports, retention, restore drills and alerts must be configured. VPS snapshots alone are not proof of a recoverable database. Staff/contractor time is additional and unpriced. |
| Temporary staging/rehearsal | Separate short-lived compute and storage may add a one-time charge; obtain its exact quote before creating it. |
| Domain | planterapp.co is already purchased. No additional domain is proposed. Future renewal remains with GoDaddy. |

[R2 official pricing](https://developers.cloudflare.com/r2/pricing/). Free allowances are shared with other usage on the account and are not a hard billing cap. Configure cost alerts and usage limits where available; alerts do not necessarily stop charges.

## What must happen before spending or launch

1. Ask the owner to select and approve the concrete term/quote above, then recheck region, invoice and taxes before purchase. No paid provisioning is authorized by this proposal.
2. Assign the operations/recovery owner and agree the modest-pilot availability, backup retention and restore expectations. Select and verify the SMTP sender.
3. Prepare VPS deployment configuration around the existing Rails container. PostgreSQL and scanner stay private; enforce the existing database TLS requirement, private storage, secret handling, host allowlist and trusted reverse-proxy boundary. No security check is removed to reduce cost.
4. Rehearse clean migrations, scanned private uploads, account delivery/recovery, admin MFA, backup restoration and rollback on isolated synthetic staging. Complete iOS/Android acceptance.
5. Connect planterapp.co only when those checks pass and the owner is ready for DNS/nameserver changes. Existing demo areas remain frozen and the earlier Cloudflare static demo stays separate.

The application source remains portable. Choosing a lower-cost VPS does not change the Ruby on Rails requirement or require transferring the domain away from GoDaddy.
## Cloudflare + GitHub option — owner follow-up

GitHub remains the source, review and CI platform. GitHub Pages cannot execute server-side Ruby. The previous Cloudflare Pages static demo is not the Rails backend.

Cloudflare Containers can run a Rails container, so a Cloudflare-led deployment is a valid option to assess. Current pricing starts with Workers Paid at US$5/month plus provisioned memory/disk runtime, active CPU, applicable network, Workers and Durable Objects usage. Container disk is ephemeral by default: snapshots or an R2 filesystem mount are not a proven substitute for this application's transactional PostgreSQL database. Keep durable managed PostgreSQL external unless a different supported architecture is separately validated; do not silently replace Rails/PostgreSQL with Workers/D1.

Illustrative upper-uptime comparison, not a complete quote: a provisioned 4 GiB container running 720 hours uses 2,880 GiB-hours. After the included 25 GiB-hours, memory alone is (2,880 - 25) x 3,600 x US$0.0000025 = US$25.695, plus the US$5 plan and disk/CPU/other charges. Sleeping can reduce this substantially, but scanner cold starts, signature refresh, traffic patterns and scheduler reliability require measurement. Therefore US$5 is not the full system price and Cloudflare is not ruled out or assumed cheaper.

The Cloudflare option still needs a private upload-scanning arrangement, private R2, verified mail, database backups and staging tests. No vendor has been selected or purchased. Compare measured pilot cost and operational burden before recommending a contract. The owner can keep planterapp.co at GoDaddy in either architecture.

Sources checked 25 October 2026: [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/), [Container lifecycle and disk persistence](https://developers.cloudflare.com/containers/faq/), [GitHub Pages server-side limitations](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).