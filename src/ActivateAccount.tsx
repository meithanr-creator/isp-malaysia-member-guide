import { useEffect, useRef, useState, type FormEvent } from 'react';
import { activateMembership, createOwnAccount, enrollmentError } from './enrollment';
import { refreshSession, requestEmailVerification, sessionResultIsCurrent, type Session } from './firebase';

function Link({ href, children, navigate, className }: { href: string; children: React.ReactNode; navigate: (path: string) => void; className?: string }) {
  return <a href={href} className={className} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(href); } }}>{children}</a>;
}
export default function ActivateAccount({ session, refresh, navigate }: { session: Session; refresh: (value: Session) => boolean; navigate: (path: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState(false), [showPassword, setShowPassword] = useState(false), [reference, setReference] = useState('');
  const alive = useRef(true), running = useRef(false), latest = useRef(session);
  latest.current = session;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function stillCurrent(start: Session) {
    return alive.current && sessionResultIsCurrent(start) && latest.current.identity.uid === start.identity.uid && latest.current.identity.epoch === start.identity.epoch;
  }
  async function run(work: (start: Session) => Promise<void>) {
    if (running.current || !sessionResultIsCurrent(session)) return;
    const start = session; running.current = true; setBusy(true); setError('');
    try { await work(start); }
    catch (caught) { if (stillCurrent(start)) setError(enrollmentError(caught)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, values = new FormData(form);
    const email = String(values.get('email') ?? ''), password = String(values.get('password') ?? ''), confirmation = String(values.get('confirmation') ?? '');
    void run(async start => { try { await createOwnAccount(email, password, confirmation, start); } finally { form.reset(); } });
  }
  function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async start => {
      await activateMembership(reference, start);
      if (!stillCurrent(start)) return;
      const next = await refreshSession();
      if (stillCurrent(start) && refresh(next) && next.memberAccess) navigate('/member/dashboard');
    });
  }
  const checking = session.status === 'loading' || session.status === 'signing-out', staff = session.adminClaim || session.staffActive;
  return <section className="page account-login">
    <Link href="/" navigate={navigate} className="back">Home</Link><span className="eyebrow">Your ISP community</span><h1>Activate your account.</h1><p className="intro">Registration is invitation-only for existing ISP members.</p>
    {checking ? <p role="status">Checking your account…</p> : session.status === 'unconfigured' || session.status === 'error' ? <div className="validation-errors" role="alert">{session.message || 'The account connection is unavailable. Please try again later.'}</div> : staff ? <section className="signin-panel"><h2>Administrator account</h2><p>Use administrator sign-in and your authenticator for this account.</p><Link href={session.adminAccess ? '/admin/members' : '/admin/authenticator'} navigate={navigate} className="primary full">{session.adminAccess ? 'Open administration' : 'Set up authenticator'}</Link></section> : <>
      {error && <div className="validation-errors" role="alert">{error}<p><Link href="/about" navigate={navigate}>Contact ISP</Link></p></div>}
      {!session.user ? <section className="signin-panel"><h2>Create your account</h2><p className="form-hint">Use the exact email address on your ISP membership record and choose your own password. Member access requires email verification and membership activation.</p><form className="signin-form" onSubmit={signup} aria-busy={busy}>
        <label className="field">Email address<input name="email" type="email" required maxLength={160} autoComplete="username" /></label>
        <label className="field">Password<div className="password-wrap"><input name="password" type={showPassword ? 'text' : 'password'} required minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="new-password-help" /><button type="button" className="password-toggle" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
        <p id="new-password-help" className="form-hint">Use 12 to 128 characters.</p><label className="field">Confirm password<input name="confirmation" type={showPassword ? 'text' : 'password'} required minLength={12} maxLength={128} autoComplete="new-password" /></label>
        <button type="submit" className="primary full" disabled={busy || session.status !== 'signed-out'}>{busy ? 'Creating account…' : 'Create my account'}</button>
      </form><p className="form-hint"><Link href="/login" navigate={navigate}>Already have an account? Sign in</Link></p><p className="form-hint"><Link href="/password-recovery" navigate={navigate}>Password help</Link></p><p className="form-hint"><Link href="/about" navigate={navigate}>Contact ISP for an invitation or an email update</Link></p></section> : !session.user.emailVerified ? <section className="signin-panel"><h2>Verify your email</h2><p className="form-hint">Signed in as {session.user.email}. Request a verification email, follow its link, then return here.</p>{sent && <p role="status">Verification email sent. Check your inbox before continuing.</p>}<div className="stack">
        <button type="button" className="primary full" disabled={busy || sent} onClick={() => void run(async start => { await requestEmailVerification(); if (stillCurrent(start)) setSent(true); })}>{sent ? 'Verification email sent' : 'Send verification email'}</button>
        <button type="button" className="secondary full" disabled={busy} onClick={() => void run(async start => { const next = await refreshSession(); if (stillCurrent(start)) refresh(next); })}>{busy ? 'Checking…' : 'I have verified my email'}</button>
      </div></section> : session.member?.status === 'suspended' ? <section className="signin-panel"><h2>Contact ISP</h2><p>Your membership access is unavailable. Please contact ISP before continuing.</p><Link href="/about" navigate={navigate} className="primary full">Contact ISP</Link></section> : <section className="signin-panel"><h2>Connect your membership</h2><p className="form-hint">Signed in as {session.user.email}. Enter the reference from your ISP membership record, keeping letters and leading zeros exactly as issued.</p><form className="signin-form" onSubmit={activate} aria-busy={busy}>
        <label className="field">Membership reference<input name="memberReference" type="text" required maxLength={80} autoComplete="off" autoCapitalize="none" spellCheck={false} value={reference} onChange={event => setReference(event.target.value)} /></label>
        <button type="submit" className="primary full" disabled={busy}>{busy ? 'Checking membership…' : 'Activate my membership'}</button>
      </form><p className="form-hint">Your verified email and membership reference must match an eligible ISP record.</p><Link href="/about" navigate={navigate} className="link-button">Contact ISP</Link></section>}
    </>}
  </section>;
}
