import { flushSync } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import ActivateAccount from './ActivateAccount';
import { ConnectedDiscover, ConnectedInterests, ContentRoute, HomeEvents, HomePublications } from './ContentPages';
import { useCallback, useEffect, useRef, useState, type AnchorHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import {
  beginTotpEnrollment, cancelMfa, cancelTotpEnrollment, completeTotp, emptySession, finishTotpEnrollment, friendlyError, loadRoster, observeSession,
  refreshSession, requestEmailVerification, requestPasswordRecovery, saveProfile, sessionResultIsCurrent, signIn, signOutMember,
  type Member, type ProfileFields, type RosterCursor, type RosterPage, type Session,
} from './firebase';

function Icon({ name }: { name: string }) {
  return <img className="ui-icon" src={'/assets/' + name + '.svg'} alt="" />;
}

function go(path: string) {
  let destination = path;
  if (path === '/member/dashboard' && window.location.pathname === '/login') {
    const requested = new URLSearchParams(window.location.search).get('returnTo');
    if (requested && /^\/events\/[A-Za-z0-9_-]{1,80}\/interest$/.test(requested)) destination = requested;
  }
  window.history.pushState({ postLoginReturn: destination !== path }, '', destination);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function Link({ href, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={href} {...props} onClick={event => {
    onClick?.(event);
    if (!event.defaultPrevented && href?.startsWith('/') && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault(); go(href);
    }
  }}>{children}</a>;
}

function Notice({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return <div className={'flash' + (alert ? ' alert' : '')} role={alert ? 'alert' : 'status'}>{children}</div>;
}

export default function App() {
  const [session, setSession] = useState<Session>(emptySession);
  const [path, setPath] = useState(window.location.pathname);
  const [error, setError] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  const receiveSession = useCallback((next: Session) => {
    if (!sessionResultIsCurrent(next)) return false;
    setSession(next); return true;
  }, []);
  const clearPrivateView = useCallback((next: Session) => {
    flushSync(() => receiveSession(next));
  }, [receiveSession]);
  useEffect(() => observeSession(receiveSession), [receiveSession]);
  useEffect(() => {
    if (session.status === 'ready' && (path === '/login' || path === '/member/dashboard' || window.history.state?.postLoginReturn === true) && session.adminClaim && session.staffActive && session.user?.emailVerified) go(session.adminAccess ? '/admin/members' : '/admin/authenticator');
    else if (session.status === 'ready' && path === '/login' && session.memberAccess) go('/member/dashboard');
  }, [session, path]);
  useEffect(() => {
    const changed = () => {
      setPath(window.location.pathname); setError('');
      if (menu.current) menu.current.open = false;
      window.scrollTo(0, 0);
      requestAnimationFrame(() => document.getElementById('main')?.focus({ preventScroll: true }));
    };
    window.addEventListener('popstate', changed);
    const dismiss = (event: Event) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false; menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('popstate', changed); document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  const accountPath = session.adminClaim ? '/admin/members' : '/member/dashboard';
  async function logout() {
    try { await signOutMember(clearPrivateView); go('/'); }
    catch (caught) { setError(friendlyError(caught)); }
  }
  let content: ReactNode;
  if (path === '/') content = <ConnectedDiscover session={session}>{connectedSlides => <Home session={session} connectedSlides={connectedSlides} />}</ConnectedDiscover>;
  else if (path === '/about') content = <About />;
  else if (path === '/activate-account') content = <ActivateAccount key={session.identity.epoch + ':' + (session.user?.uid ?? '')} session={session} refresh={receiveSession} navigate={go} />;
  else if (path === '/login') content = session.user ? <Access key={session.identity.epoch + ':' + (session.user?.uid ?? '')} session={session} refresh={receiveSession} /> : <Login session={session} />;
  else if (path === '/admin/authenticator' && session.user?.emailVerified && (session.status === 'loading' || (session.status === 'ready' && session.adminClaim && session.staffActive))) {
    content = <TotpEnrollment key={session.identity.epoch + ':' + session.user.uid} clearPrivateView={clearPrivateView} checking={session.status !== 'ready'} />;
  } else if (path.startsWith('/admin/')) {
    content = session.status === 'ready' && session.adminAccess
      ? <><AdminNavigation path={path} /><ContentRoute key={session.identity.epoch + ':' + session.user!.uid + ':' + path} path={path} session={session} /></>
      : <Access key={session.identity.epoch + ':' + (session.user?.uid ?? '')} session={session} refresh={receiveSession} admin />;
  } else if (path.startsWith('/member/')) {
    content = session.status === 'ready' && session.memberAccess && session.member
      ? path === '/member/profile' ? <Profile member={session.member} updated={receiveSession} />
        : path === '/member/dashboard' || path === '/member/membership' ? <Dashboard member={session.member} membership={path === '/member/membership'} interests={<ConnectedInterests key={session.identity.epoch + ':' + session.user!.uid} session={session} />} />
          : <ContentRoute key={session.identity.epoch + ':' + session.user!.uid + ':' + path} path={path} session={session} />
      : <Access key={session.identity.epoch + ':' + (session.user?.uid ?? '')} session={session} refresh={receiveSession} />;
  } else if (path === '/events' || path.startsWith('/events/')) content = <ContentRoute key={session.identity.epoch + ':' + (session.user?.uid ?? '') + ':' + path} path={path} session={session} />;
  else if (path === '/password-recovery') content = <Recovery session={session} />;
  else content = <Pending title="This page is unavailable." description="Return home to continue exploring ISP." />;
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <div className={'app-shell' + (path.startsWith('/admin/') ? ' admin-shell' : '')}>
      <header className="brandbar">
        <Link href="/" className="brand" aria-label="ISP home"><img src="/assets/isp-crest.png" alt="Official ISP crest" /><span>The Incorporated<br />Society of Planters<small>MALAYSIA · EST. 1919</small></span></Link>
        <div className="header-actions">
          <Link href={session.user ? accountPath : '/login'} className="account-control">{session.user ? 'Dashboard' : 'Login'}</Link>
          <details className="menu-root" ref={menu}><summary aria-label="Explore ISP menu"><Icon name="list" /></summary>
            <nav className="menu" aria-label="Explore ISP">
              <span className="menu-heading">Explore ISP</span>
              <Link href="/"><Icon name="house-door-fill" />Home</Link>
              <Link href="/events"><Icon name="calendar3" />Events & activities</Link>
              {!session.adminClaim && <>
                <Link href="/member/membership"><Icon name="people-fill" />Membership</Link><Link href="/activate-account"><Icon name="people-fill" />Activate account</Link>
                <Link href="/member/publications"><Icon name="journal-bookmark" /><span>Publications<small>Members only</small></span></Link>
                <Link href="/member/consultation"><Icon name="bar-chart-line" /><span>Consultation<small>Members only</small></span></Link>
              </>}
              <Link href="/about"><Icon name="book" />About & contact</Link>
              {session.adminClaim && <><div className="menu-divider" /><span className="menu-heading">Administration</span>
                <Link href="/admin/members"><Icon name="people-fill" />Membership list</Link>
                <Link href="/admin/events"><Icon name="calendar3" />Events</Link>
                <Link href="/admin/discover"><Icon name="file-earmark-text" />Edit Discover ISP</Link>
                <Link href="/admin/publications"><Icon name="journal-bookmark" />Manage publications</Link>
                <Link href="/admin/consultation"><Icon name="bar-chart-line" />Consultation enquiries</Link>
              </>}
              {session.user && <><div className="menu-divider" /><button type="button" className="menu-signout" onClick={() => void logout()}><Icon name="box-arrow-right" />Sign out</button></>}
            </nav>
          </details>
        </div>
      </header>
      <main id="main" tabIndex={-1}>{error && <Notice alert>{error}</Notice>}{content}</main>
      <nav className="bottom-nav" aria-label="Events navigation"><Link href="/events" aria-current={path === '/events' ? 'page' : undefined}><Icon name="calendar3" />Events</Link></nav>
    </div>
  </>;
}

function Login({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [showPassword, setShowPassword] = useState(false), [mfa, setMfa] = useState(false);
  useEffect(() => () => cancelMfa(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget, values = new FormData(form);
    setBusy(true); setError('');
    try {
      if (mfa) { await completeTotp(String(values.get('code') ?? '')); go('/member/dashboard'); }
      else {
        const outcome = await signIn(String(values.get('email') ?? ''), String(values.get('password') ?? ''));
        form.reset();
        if (outcome === 'totp-required') setMfa(true);
        else go('/member/dashboard');
      }
    } catch (caught) { setError(friendlyError(caught)); }
    finally { setBusy(false); }
  }
  return <section className="page account-login">
    <Link href="/" className="back"><Icon name="arrow-left" />Home</Link>
    <span className="eyebrow">{mfa ? 'Administrator access' : 'Your ISP community'}</span>
    <h1>{mfa ? 'Verify your sign-in.' : 'Welcome back.'}</h1>
    {!mfa && <p className="intro">A place for your professional journey.</p>}
    <section className="signin-panel">
      <h2>{mfa ? 'Authenticator code' : 'Member login'}</h2>
      <p className="form-hint">{mfa ? 'Enter the current six-digit code from your authenticator app.' : 'Use your email address and password to open your account.'}</p>
      {session.status === 'unconfigured' && <div className="validation-errors" role="status">{session.message}</div>}
      {error && <div className="validation-errors" role="alert">{error}</div>}
      <form className="signin-form" onSubmit={event => void submit(event)} aria-busy={busy}>
        {mfa ? <label className="field">Authenticator code<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} autoFocus /></label> : <>
          <label className="field">Email address<input name="email" type="email" required maxLength={160} autoComplete="username" placeholder="member@example.com" /></label>
          <label className="field">Password<div className="password-wrap"><input name="password" type={showPassword ? 'text' : 'password'} required maxLength={128} autoComplete="current-password" /><button type="button" className="password-toggle" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
        </>}
        <button className="primary full" type="submit" disabled={busy || session.status === 'unconfigured' || session.status === 'loading'}>{busy ? 'Please wait…' : mfa ? 'Verify and continue' : 'Sign in'}<Icon name="chevron-right" /></button>
      </form>
      {mfa && <button type="button" className="text-action full" disabled={busy} onClick={() => { cancelMfa(); setMfa(false); setError(''); }}>Cancel sign-in</button>}
    </section>
    {!mfa && <p className="form-hint"><Link href="/password-recovery">Forgot your password?</Link></p>}{!mfa && <p className="form-hint"><Link href="/activate-account">Create or activate your account</Link></p>}
  </section>;
}

function Access({ session, refresh, admin = false }: { session: Session; refresh: (session: Session) => void; admin?: boolean }) {
  const [checking, setChecking] = useState(false), [error, setError] = useState(''), [verificationSent, setVerificationSent] = useState(false);
  if (session.status === 'loading' || session.status === 'signing-out') return <section className="page" role="status"><h1>Opening your member space.</h1><p>Please wait…</p></section>;
  if (!session.user) return <><Notice>{session.status === 'unconfigured' ? session.message : 'Please sign in to continue.'}</Notice><Login session={session} /></>;
  const needsAdminSetup = session.user.emailVerified && session.adminClaim && session.staffActive && !session.totpVerified;
  if (session.status === 'ready' && !needsAdminSetup && (admin ? session.adminAccess : session.memberAccess || session.adminAccess)) {
    return <section className="page"><h1>Your member space is ready.</h1><Link href={session.adminAccess ? '/admin/members' : '/member/dashboard'} className="primary full">Open dashboard<Icon name="chevron-right" /></Link></section>;
  }
  const message = session.status === 'error' ? session.message
    : !session.user.emailVerified ? 'Please verify your email address before opening member resources.'
    : needsAdminSetup ? 'Set up your authenticator, then sign in again with its current code.'
    : admin ? 'Administrator access is not available for this account.'
    : session.member?.status === 'suspended' ? 'Your membership access is unavailable. Please contact ISP.'
    : 'Connect your verified account to your ISP membership to continue.';
  async function verifyEmail() {
    setChecking(true); setError('');
    try { await requestEmailVerification(); setVerificationSent(true); }
    catch (caught) { setError(friendlyError(caught)); }
    finally { setChecking(false); }
  }
  async function check() {
    setChecking(true); setError('');
    try { refresh(await refreshSession()); } catch (caught) { setError(friendlyError(caught)); }
    finally { setChecking(false); }
  }
  return <section className="page membership-page"><span className="eyebrow">Your member space</span><h1>Your connection to ISP.</h1><p className="intro">{message}</p>{error && <div className="validation-errors" role="alert">{error}</div>}    {verificationSent && <p className="form-hint" role="status">Verification email sent. Follow its link, then check access again.</p>}
    <div className="stack">
      {!session.user.emailVerified && <button type="button" className="primary full" disabled={checking || verificationSent} onClick={() => void verifyEmail()}>{verificationSent ? 'Verification email sent' : 'Send verification email'}</button>}
      {needsAdminSetup && <Link href="/admin/authenticator" className="primary full">Set up authenticator<Icon name="chevron-right" /></Link>}{!session.adminClaim && !session.staffActive && session.member?.status !== 'suspended' && <Link href="/activate-account" className="primary full">Activate your membership<Icon name="chevron-right" /></Link>}
      <button type="button" className="secondary full" onClick={() => void check()} disabled={checking}>{checking ? 'Checking…' : 'Check access again'}</button><Link href="/about" className="link-button">Contact ISP<Icon name="chevron-right" /></Link></div></section>;
}

function Dashboard({ member, membership, interests }: { member: Member; membership: boolean; interests?: ReactNode }) {
  const initials = member.displayName.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('');
  return <section className={'page ' + (membership ? 'membership-page' : 'member-home')}>
    <span className="eyebrow">{membership ? 'Membership' : 'Your member space'}</span>
    <h1>{membership ? 'Your connection to ISP.' : 'Hello, ' + (member.displayName.trim().split(/\s+/)[0] || 'member') + '.'}</h1>
    <p className="intro">{membership ? 'Keep your profile up to date and make the most of your member resources.' : 'Your next connection starts here.'}</p>
    <article className="profile-card"><div className="profile-heading"><span className="avatar">{initials || 'ISP'}</span><div><h2>{member.displayName || 'ISP member'}</h2><p>Member profile</p></div></div>
      <dl className="profile-details">{[
        ...(member.membershipReference ? [['Membership reference', member.membershipReference]] : []),
        ['Email', member.email], ['Organisation', member.company], ['Branch', member.branch], ['Telephone', member.phone],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not added'}</dd></div>)}</dl>
      <Link href="/member/profile" className="link-button">Edit your profile<Icon name="chevron-right" /></Link><Link href="/activate-account" className="link-button">Activate or check your membership<Icon name="chevron-right" /></Link>
    </article>
    {!membership && interests}
    <div className="member-legacy"><h2>Keep your journey growing</h2><div className="stack">
      <Link href="/member/publications" className="service-row"><Icon name="journal-bookmark" /><span>Read The Planter<small>Your member library</small></span><Icon name="chevron-right" /></Link>
      <Link href="/member/consultation" className="service-row"><Icon name="bar-chart-line" /><span>Consultation<small>Send an enquiry to ISP</small></span><Icon name="chevron-right" /></Link>
      <Link href="/events" className="service-row"><Icon name="calendar3" /><span>Events & activities<small>Explore upcoming opportunities</small></span><Icon name="chevron-right" /></Link>
    </div></div>
  </section>;
}

function Profile({ member, updated }: { member: Member; updated: (session: Session) => boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const values = new FormData(event.currentTarget);
    const input: ProfileFields = { displayName: String(values.get('displayName') ?? ''), company: String(values.get('company') ?? ''), branch: String(values.get('branch') ?? ''), phone: String(values.get('phone') ?? '') };
    setBusy(true); setError('');
    try { if (updated(await saveProfile(input))) go('/member/dashboard'); }
    catch (caught) { setError(friendlyError(caught)); }
    finally { setBusy(false); }
  }
  return <section className="page profile-edit"><span className="eyebrow">Your member profile</span><h1>Make yourself at home.</h1><p className="intro">Keep your contact details up to date.</p>
    {error && <div className="validation-errors" role="alert">{error}</div>}
    <form onSubmit={event => void submit(event)} aria-busy={busy}>
      <label className="field">Full name<input name="displayName" defaultValue={member.displayName} required maxLength={80} autoComplete="name" /></label>
      <label className="field">Email address<input type="email" value={member.email} disabled /><small>Your login address is managed separately.</small></label>
      <label className="field">Organisation<input name="company" defaultValue={member.company} maxLength={120} autoComplete="organization" /></label>
      <label className="field">Branch<input name="branch" defaultValue={member.branch} maxLength={100} /></label>
      <label className="field">Telephone<input name="phone" type="tel" defaultValue={member.phone} maxLength={40} autoComplete="tel" /></label>
      <div className="stack"><button className="primary full" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button><Link href="/member/dashboard" className="text-action full">Cancel</Link></div>
    </form>
  </section>;
}

const adminTitles: Record<string, string> = { '/admin/members': 'Membership list', '/admin/events': 'Events', '/admin/publications': 'Publications', '/admin/discover': 'Discover ISP', '/admin/consultation': 'Consultation enquiries' };
const memberTitles: Record<string, string> = { '/member/publications': 'Your member library', '/member/consultation': 'Consultation' };
function AdminNavigation({ path }: { path: string }) {
  return <nav className="admin-navigation" aria-label="Administration"><span className="menu-heading">Admin workspace</span><div className="admin-navigation-links">{[
    ['/admin/members', 'Membership list', 'people-fill'], ['/admin/events', 'Events', 'calendar3'], ['/admin/publications', 'Publications', 'journal-bookmark'], ['/admin/discover', 'Discover ISP', 'file-earmark-text'], ['/admin/consultation', 'Consultation enquiries', 'bar-chart-line'],
  ].map(([href, label, icon]) => <Link key={href} href={href} aria-current={path === href || path.startsWith(href + '/') ? 'page' : undefined}><Icon name={icon} /><span>{label}</span></Link>)}</div></nav>;
}

function Roster() {
  const [cursors, setCursors] = useState<RosterCursor[]>([null]), [page, setPage] = useState<RosterPage | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true; setBusy(true); setPage(null); setError('');
    void loadRoster(cursors[cursors.length - 1]).then(result => { if (active) setPage(result); }).catch(caught => { if (active) setError(friendlyError(caught)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [cursors]);
  return <section className="page membership-admin"><span className="eyebrow">Administration · membership authority</span><h1>The membership list.</h1><p className="intro">Eligibility from the administrator list stays separate from account activation.</p><p className="form-hint">Showing up to 25 membership entries per page.</p>
    {busy && <p role="status">Loading membership entries…</p>}
    {error && <div className="validation-errors" role="alert">{error}</div>}
    {page?.members.length === 0 && <div className="empty-state"><h2>No membership entries on this page.</h2><p>The approved membership list has no further entries to display here.</p></div>}
    <ul className="membership-row-list" aria-label="Membership list">{page?.members.map(member => <li className="membership-row" key={member.uid}><h2>{member.displayName || 'Member'}</h2><dl className="membership-details"><div><dt>Membership reference</dt><dd>{member.membershipReference || 'Not added'}</dd></div><div><dt>Email</dt><dd>{member.email}</dd></div><div><dt>Eligibility</dt><dd>{member.status}</dd></div></dl></li>)}</ul>
    <nav className="membership-pagination" aria-label="Membership pages">{cursors.length > 1 && <button className="link-button" type="button" disabled={busy} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous 25</button>}<span>Page {cursors.length}</span>{page?.nextCursor && <button className="link-button" type="button" disabled={busy} onClick={() => setCursors(previous => [...previous, page.nextCursor])}>Next 25</button>}</nav>
  </section>;
}

const slides = [
  { tag: 'A profession. A community.', title: 'Rooted in the field. Looking to the future.', description: 'Since 1919, ISP has connected planters through knowledge, professional fellowship and a shared commitment to progress.', href: 'https://isp.org.my/v4/', image: 'plantation-small.jpg', alt: 'Oil palm plantation beneath a wide sky' },
  { tag: 'Knowledge worth sharing', title: 'A profession that keeps learning.', description: 'Explore The Planter and ISP publications, connecting field experience with fresh perspectives from the plantation profession.', href: 'https://isp.org.my/v4/library/', image: 'planter-cover.jpg', alt: 'The Planter professional publication cover' },
  { tag: 'Ideas grow in good company', title: 'Make a connection. Share a new perspective.', description: 'Discover workshops, field visits and conversations that bring the plantation community together.', href: 'https://isp.org.my/v4/event/', image: 'member-events.jpg', alt: 'Plantation professionals exchanging ideas' },
];

function Home({ session, connectedSlides }: { session: Session; connectedSlides?: typeof slides }) {
  const carouselSlides = connectedSlides?.length ? connectedSlides : slides;
  const [index, setIndex] = useState(0), [paused, setPaused] = useState(false), [held, setHeld] = useState(false);
  useEffect(() => {
    if (paused || held || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setIndex(value => (value + 1) % carouselSlides.length), 8000);
    return () => window.clearInterval(timer);
  }, [paused, held, carouselSlides.length]);
  const activeIndex = Math.min(index, carouselSlides.length - 1), slide = carouselSlides[activeIndex];
  return <>
    <section className="welcome-hero"><img src="/assets/welcome-palms.jpg" alt="Oil palm plantation with a mountain backdrop" /><div className="welcome-copy"><span className="eyebrow">People. Plants. Progress.</span><h1>A community of planters.<br />A shared future.</h1><p>Connect with your profession.<br />Learn, contribute and grow with ISP.</p></div></section>
    <section className="home-section discover-section" aria-roledescription="carousel" aria-label="Discover ISP" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHeld(false); }}>
      <div className="section-head"><h2>Discover ISP</h2><span className="quiet-caption">Since 1919</span></div>
      <article className="discover-card" aria-label={(activeIndex + 1) + ' of ' + carouselSlides.length}><img src={slide.image.startsWith('blob:') || slide.image.startsWith('/assets/') ? slide.image : '/assets/' + slide.image} alt={slide.alt} /><div className="discover-copy"><span className="eyebrow">{slide.tag}</span><h3>{slide.title}</h3><p>{slide.description}</p><a href={slide.href} className="link-button" target="_blank" rel="noopener noreferrer">Click to Access Website<Icon name="chevron-right" /></a></div></article>
      <div className="discover-controls"><button className="carousel-arrow" type="button" aria-label="Previous slide" onClick={() => setIndex((activeIndex + carouselSlides.length - 1) % carouselSlides.length)}>‹</button><div className="slide-selectors">{carouselSlides.map((_, number) => <button className="slide-dot" key={number} type="button" aria-label={'Show slide ' + (number + 1)} aria-current={number === activeIndex ? 'true' : undefined} onClick={() => setIndex(number)} />)}</div><button className="carousel-arrow" type="button" aria-label="Next slide" onClick={() => setIndex((activeIndex + 1) % carouselSlides.length)}>›</button><button className="carousel-pause" type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? 'Play' : 'Pause'}</button></div>
    </section>
    <section className="home-section home-upcoming"><div className="section-head"><h2>Events & activities</h2><Link href="/events" className="link-button">View all<Icon name="chevron-right" /></Link></div><p className="section-lede">Fresh perspectives, shared in good company.</p><HomeEvents session={session} /></section>
    <HomePublications session={session} />
    <footer className="home-footer"><span>The Incorporated Society of Planters</span><Link href="/about" className="link-button">About & contact<Icon name="chevron-right" /></Link></footer>
  </>;
}

function Recovery({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    setBusy(true); setError('');
    try { await requestPasswordRecovery(email); setSent(true); }
    catch (caught) { setError(friendlyError(caught)); }
    finally { setBusy(false); }
  }
  return <section className="page account-login"><Link href="/login" className="back"><Icon name="arrow-left" />Member login</Link><span className="eyebrow">Your ISP account</span><h1>Find your way back.</h1><p className="intro">Enter your login email address to request a password reset.</p><section className="signin-panel">
    {sent ? <p role="status">If an account uses that email address, you will receive a password reset link. Please check your inbox.</p> : <form className="signin-form" onSubmit={event => void submit(event)} aria-busy={busy}>
      {session.status === 'unconfigured' && <p className="form-hint">{session.message}</p>}
      {error && <div className="validation-errors" role="alert">{error}</div>}
      <label className="field">Email address<input name="email" type="email" required maxLength={160} autoComplete="email" /></label>
      <button type="submit" className="primary full" disabled={busy || session.status === 'unconfigured'}>{busy ? 'Please wait…' : 'Request reset link'}<Icon name="chevron-right" /></button>
    </form>}
  </section></section>;
}

function TotpEnrollment({ clearPrivateView, checking }: { clearPrivateView: (session: Session) => void; checking: boolean }) {
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof beginTotpEnrollment>> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => () => cancelTotpEnrollment(), []);
  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || checking) return;
    const form = event.currentTarget, password = String(new FormData(form).get('password') ?? '');
    form.reset(); setBusy(true); setError('');
    try { setSetup(await beginTotpEnrollment(password)); }
    catch (caught) { setError(friendlyError(caught)); }
    finally { setBusy(false); }
  }
  async function finish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || checking) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '');
    setBusy(true); setError('');
    try {
      await finishTotpEnrollment(code, clearPrivateView);
      setSetup(null); go('/login');
    } catch (caught) { setError(friendlyError(caught)); }
    finally { setBusy(false); }
  }
  function cancel() { cancelTotpEnrollment(); setSetup(null); go('/admin/members'); }
  return <section className="page account-login"><span className="eyebrow">Administrator access</span><h1>Set up your authenticator.</h1>{checking ? <p role="status">Checking administrator access…</p> : <section className="signin-panel">
    {error && <div className="validation-errors" role="alert">{error}</div>}
    {!setup ? <><p>Confirm your password before adding an authenticator to your account.</p><form className="signin-form" onSubmit={event => void begin(event)} aria-busy={busy}><label className="field">Current password<input name="password" type="password" required maxLength={128} autoComplete="current-password" /></label><button type="submit" className="primary full" disabled={busy}>{busy ? 'Please wait…' : 'Continue'}<Icon name="chevron-right" /></button></form></> : <>
      <p>Scan this QR code with your authenticator app, or add the account using the private setup key below. Then enter the current six-digit code. Keep the QR code and key private.</p>
      <div className="auth-setup-qr"><QRCodeSVG value={setup.qrCodeUri} size={264} level="M" marginSize={4} bgColor="#ffffff" fgColor="#000000" role="img" aria-label="Private authenticator setup QR code" title="Scan with your authenticator app" /></div>
      <div className="field"><span className="auth-setup-key-label">Private setup key</span><code className="auth-setup-key">{setup.secretKey}</code></div>
      <p className="form-hint">Issuer: ISP Member Portal<br />Account: {setup.account}<br />Time based · six digits · 30-second interval</p>
      <form className="signin-form" onSubmit={event => void finish(event)} aria-busy={busy}><label className="field">Authenticator code<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} /></label><button type="submit" className="primary full" disabled={busy}>{busy ? 'Verifying…' : 'Verify and continue'}</button></form>
      <p className="form-hint">After setup, sign in again with your password and authenticator. Administrator access stays closed until that sign-in succeeds.</p>
    </>}
    <button type="button" className="text-action full" disabled={busy} onClick={cancel}>Cancel setup</button>
  </section>}</section>;
}
function Pending({ title, description = 'This area is being connected and is not available yet.' }: { title: string; description?: string }) {
  return <section className="page"><Link href="/" className="back"><Icon name="arrow-left" />Home</Link><span className="eyebrow">Your ISP community</span><h1>{title}</h1><p className="intro">{description}</p></section>;
}

function About() {
  return <section className="page"><Link href="/" className="back"><Icon name="arrow-left" />Home</Link><span className="eyebrow">People. Plants. Progress.</span><h1>Rooted in a shared profession.</h1><img src="/assets/plantation-small.jpg" alt="Oil palm plantation" className="about-image" /><section className="editorial-section"><h2>Since 1919</h2><p>ISP supports the plantation profession through knowledge, publications, education and professional fellowship.</p><a href="https://isp.org.my/v4/" target="_blank" rel="noopener noreferrer" className="link-button">Explore the official ISP website</a></section><section className="editorial-section"><h2>Contact ISP</h2><p><a href="tel:+60379555561">+603 7955 5561</a><br /><a href="mailto:isphq@isp.org.my">isphq@isp.org.my</a></p><p>Suite 3A01, Level 3A, PJ Tower, Amcorp Trade Centre,<br />18 Persiaran Barat, 46050 Petaling Jaya, Selangor.</p></section></section>;
}
