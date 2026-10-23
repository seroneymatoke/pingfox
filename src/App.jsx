import { useEffect, useRef, useState } from 'react';
import landingHtml from '../frontend/landing.html?raw';

function FoxMark({ size = 30 }) {
  return <svg className="fox-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M6 12 4 5l7 4 5-3 5 3 7-4-2 7c0 8-4.5 13-10 13S6 20 6 12Z" fill="#FF6B3D" />
    <circle cx="12.5" cy="14" r="1.4" fill="#14161C" />
    <circle cx="19.5" cy="14" r="1.4" fill="#14161C" />
    <path d="M13 18.5c1 1 4 1 5 0" stroke="#14161C" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

function Landing({ onStart }) {
  const rootRef = useRef(null);

  function handleLandingClick(event) {
    const target = event.target.closest('a, button');
    if (!target) return;
    const label = target.textContent.toLowerCase();
    if (label.includes('start pinging') || label.includes('sign up')) {
      event.preventDefault();
      onStart();
    }
  }

  useEffect(() => {
    const scripts = [...rootRef.current.querySelectorAll('script')];
    const executedScripts = scripts.map((source) => {
      const script = document.createElement('script');
      // Scope the legacy landing script so navigating away and back does not
      // redeclare its top-level consts in the shared document.
      script.textContent = `(function () {\n${source.textContent}\n})();`;
      document.body.appendChild(script);
      source.remove();
      return script;
    });
    rootRef.current.addEventListener('click', handleLandingClick);

    return () => {
      rootRef.current?.removeEventListener('click', handleLandingClick);
      executedScripts.forEach((script) => script.remove());
    };
  }, [onStart]);

  return <div ref={rootRef} className="landing-page" dangerouslySetInnerHTML={{ __html: landingHtml }} />;
}

function Toast({ message, critical = false, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 2800);
    return () => clearTimeout(timer);
  }, [onClose]);

  return <div className={`toast${critical ? ' critical' : ''}`} role="status"><span className="dot" />{message}</div>;
}

function ProviderIcon({ provider }) {
  if (provider === 'Google') return <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.72-.06-1.42-.18-2.09H12v3.96h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.89-1.74 2.99-4.31 2.99-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.22-2.51c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.06v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.9A6 6 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.06A10 10 0 0 0 2 12c0 1.61.39 3.13 1.06 4.49l3.33-2.59Z"/><path fill="#EA4335" d="M12 5.97c1.47 0 2.79.51 3.83 1.51l2.87-2.87C16.96 2.99 14.7 2 12 2a10 10 0 0 0-8.94 5.51l3.33 2.59C7.18 7.73 9.39 5.97 12 5.97Z"/></svg>;
  if (provider === 'Facebook') return <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.5h3.05V9.4c0-3.04 1.79-4.72 4.56-4.72 1.32 0 2.7.24 2.7.24v2.99h-1.52c-1.5 0-1.97.94-1.97 1.9v2.25h3.35l-.54 3.5H13.9V24C19.62 23.1 24 18.1 24 12.07Z"/></svg>;
  return <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F35325" d="M1 1h10.5v10.5H1z"/><path fill="#81BC06" d="M12.5 1H23v10.5H12.5z"/><path fill="#05A6F0" d="M1 12.5h10.5V23H1z"/><path fill="#FFBA08" d="M12.5 12.5H23V23H12.5z"/></svg>;
}

function OAuthButton({ provider, onClick }) {
  return <button type="button" className="oauth-button" onClick={onClick}><ProviderIcon provider={provider} /><span>{provider}</span></button>;
}

function Login({ onLogin, onRegister, onBackToLanding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [oauthMessage, setOauthMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      setError((await response.json()).error || 'Could not log in.');
      return;
    }
    onLogin(await response.json());
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <button type="button" className="auth-brand auth-brand-link" onClick={onBackToLanding} aria-label="Back to PingFox landing page"><FoxMark /><span>PingFox</span></button>
      <p className="auth-kicker">Welcome back</p>
      <h1>Keep the cash moving.</h1>
      <p className="auth-subtitle">Log in to your invoice workspace and let PingFox handle the follow-up.</p>
      {error && <div className="error-box"><span className="dot" />{error}</div>}
      {oauthMessage && <div className="oauth-note">{oauthMessage}</div>}
      <form onSubmit={submit} className="stack-form">
        <label>Email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button className="primary-button" type="submit">Log in <span aria-hidden="true">→</span></button>
      </form>
      <div className="auth-divider"><span>or continue with</span></div>
      <div className="oauth-actions">
        <OAuthButton provider="Google" onClick={() => setOauthMessage('Google sign-in will be available soon.')} />
        <OAuthButton provider="Facebook" onClick={() => setOauthMessage('Facebook sign-in will be available soon.')} />
        <OAuthButton provider="Microsoft" onClick={() => setOauthMessage('Microsoft sign-in will be available soon.')} />
      </div>
      <p className="auth-footer">New to PingFox? <button type="button" onClick={onRegister}>Start free</button></p>
      <button type="button" className="back-to-landing" onClick={onBackToLanding}>← Back to landing page</button>
    </section>
  </main>;
}

function Register({ onRegister, onBackToLanding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    const response = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, terms_accepted: termsAccepted, privacy_accepted: privacyAccepted }),
    });
    if (!response.ok) {
      setError((await response.json()).error || 'Could not create your account.');
      return;
    }
    onRegister(await response.json());
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <button type="button" className="auth-brand auth-brand-link" onClick={onBackToLanding} aria-label="Back to PingFox landing page"><FoxMark /><span>PingFox</span></button>
      <p className="auth-kicker">Start for free</p>
      <h1>Get paid without the awkwardness.</h1>
      <p className="auth-subtitle">Create your workspace and get your first 3 invoices free, forever.</p>
      {error && <div className="error-box"><span className="dot" />{error}</div>}
      <form onSubmit={submit} className="stack-form registration-form">
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <div className="form-grid"><label>Password<input type="password" required minLength="8" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>Confirm password<input type="password" required minLength="8" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label></div>
        <div className="consent-list"><label className="checkbox-label"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} required /> I agree to the <a href="#terms">Terms of Service</a>.</label><label className="checkbox-label"><input type="checkbox" checked={privacyAccepted} onChange={event => setPrivacyAccepted(event.target.checked)} required /> I agree to the <a href="#privacy">Privacy Policy</a>.</label></div>
        <button className="primary-button" type="submit">Create account <span aria-hidden="true">→</span></button>
      </form>
      <div className="auth-divider"><span>or continue with</span></div>
      <div className="oauth-actions"><OAuthButton provider="Google" onClick={() => setError('Google sign-in will be available soon.')} /><OAuthButton provider="Facebook" onClick={() => setError('Facebook sign-in will be available soon.')} /><OAuthButton provider="Microsoft" onClick={() => setError('Microsoft sign-in will be available soon.')} /></div>
      <p className="auth-footer">Already have an account? <button type="button" onClick={() => { window.location.hash = 'login'; }}>Log in</button></p>
      <button type="button" className="back-to-landing" onClick={onBackToLanding}>← Back to landing page</button>
    </section>
  </main>;
}

function VerifyEmail({ email, onBackToLanding }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function resend() {
    setMessage('');
    setError('');
    const response = await fetch('/api/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (response.ok) setMessage('A fresh confirmation link is on its way.');
    else setError('We could not resend the email right now.');
  }

  return <main className="auth-shell"><section className="auth-card verify-card">
    <div className="auth-brand"><FoxMark /><span>PingFox</span></div>
    <p className="auth-kicker">Check your inbox</p><h1>Confirm your email.</h1>
    <p className="auth-subtitle">We sent a confirmation link to <strong>{email}</strong>. Confirm it before setting up your workspace.</p>
    {message && <div className="oauth-note">{message}</div>}
    {error && <div className="error-box"><span className="dot" />{error}</div>}
    <button className="primary-button verify-login-button" type="button" onClick={() => { onBackToLanding(); window.location.hash = 'login'; }}>I’ve verified it — log in</button>
    <p className="auth-footer">Didn't receive it? <button type="button" onClick={resend}>Resend email</button></p>
    <button type="button" className="back-to-landing" onClick={onBackToLanding}>← Back to landing page</button>
  </section></main>;
}

function Onboarding({ user, onComplete, showConfirmation = false }) {
  const [form, setForm] = useState({ full_name: '', phone: '', business_name: '', tax_id: '', residence_address: '', city: '', region: '', postal_code: '', country: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  const [error, setError] = useState('');
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/onboarding', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(form) });
    if (!response.ok) {
      setError((await response.json()).error || 'Could not save your setup.');
      return;
    }
    onComplete(await response.json());
  }

  return <main className="auth-shell"><section className="auth-card onboarding-card">
    <div className="onboarding-progress"><span className="complete">1 Account</span><span className="current">2 Set up workspace</span><span>3 First invoice</span></div>
    <div className="auth-brand"><FoxMark /><span>PingFox</span></div>
    {showConfirmation && <div className="success-box" role="status"><span aria-hidden="true">✓</span> Account confirmed successfully.</div>}
    <p className="auth-kicker">One last step</p><h1>Set up your workspace.</h1>
    <p className="auth-subtitle">Tell us a little about you so invoices, reminders, and local details are ready from day one.</p>
    {error && <div className="error-box"><span className="dot" />{error}</div>}
    <form onSubmit={submit} className="stack-form registration-form">
      <div className="form-grid"><label>Full name<input name="full_name" required autoComplete="name" value={form.full_name} onChange={update} /></label><label>Phone <span className="optional">optional</span><input name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={update} /></label></div>
      <div className="form-grid"><label>Business name <span className="optional">optional</span><input name="business_name" autoComplete="organization" value={form.business_name} onChange={update} /></label><label>Tax ID <span className="optional">optional</span><input name="tax_id" autoComplete="off" value={form.tax_id} onChange={update} /></label></div>
      <label>Residence / business address<input name="residence_address" required autoComplete="street-address" value={form.residence_address} onChange={update} /></label>
      <div className="form-grid"><label>City<input name="city" autoComplete="address-level2" value={form.city} onChange={update} /></label><label>State / region<input name="region" autoComplete="address-level1" value={form.region} onChange={update} /></label></div>
      <div className="form-grid"><label>Postal code<input name="postal_code" autoComplete="postal-code" value={form.postal_code} onChange={update} /></label><label>Country<input name="country" required autoComplete="country-name" value={form.country} onChange={update} /></label></div>
      <label>Timezone<input name="timezone" autoComplete="off" value={form.timezone} onChange={update} /></label>
      <button className="primary-button" type="submit">Finish setup <span aria-hidden="true">→</span></button>
    </form>
    <p className="auth-footer">Signed in as {user.email}</p>
  </section></main>;
}

function Dashboard({ user, onLogout }) {
  const [invoices, setInvoices] = useState([]);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('all');

  async function loadInvoices() {
    const response = await fetch('/api/dashboard', { credentials: 'include' });
    if (response.ok) setInvoices((await response.json()).invoices);
  }

  useEffect(() => { loadInvoices(); }, []);

  const visibleInvoices = invoices.filter(invoice => filter === 'all' || invoice.status === filter || (filter === 'overdue' && invoice.status === 'overdue'));
  const outstanding = invoices.filter(invoice => invoice.status !== 'paid').reduce((total, invoice) => total + invoice.amount_cents, 0);
  const overdue = invoices.filter(invoice => invoice.status === 'overdue').length;

  async function ping(id) {
    const response = await fetch(`/api/invoices/${id}/ping`, { method: 'POST', credentials: 'include' });
    if (!response.ok) {
      setToast({ message: 'Could not send ping.', critical: true });
      return;
    }
    setToast({ message: `Ping sent to ${invoices.find(invoice => invoice.id === id)?.client_name || 'client'}` });
    loadInvoices();
  }

  async function markPaid(id) {
    const response = await fetch(`/api/invoices/${id}/mark-paid`, { method: 'POST', credentials: 'include' });
    if (!response.ok) {
      setToast({ message: 'Could not mark invoice as paid.', critical: true });
      return;
    }
    setToast({ message: 'Invoice marked paid.' });
    loadInvoices();
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    onLogout();
  }

  return <main className="dashboard-shell">
    <header className="topbar"><div><FoxMark /><span className="brand">PingFox</span></div><button className="quiet-button" onClick={logout}>Log out</button></header>
    <section className="dashboard-heading"><div><p className="eyebrow">Your workspace</p><h1>Invoices</h1><p className="dashboard-subtitle">Keep every follow-up moving without chasing it yourself.</p></div><button className="primary-button">Add invoice</button></section>
    <section className="dashboard-summary" aria-label="Invoice summary">
      <div className="dashboard-summary-item"><span>Active invoices</span><strong>{invoices.length}</strong></div>
      <div className="dashboard-summary-item"><span>Outstanding</span><strong>${(outstanding / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></div>
      <div className="dashboard-summary-item"><span>Needs attention</span><strong className={overdue ? 'accent' : ''}>{overdue} overdue</strong></div>
    </section>
    <section className="invoice-card">
      <div className="invoice-card-toolbar"><strong>Recent invoices</strong><div className="invoice-filters" role="group" aria-label="Filter invoices">{['all', 'overdue', 'pending', 'paid'].map(option => <button key={option} className={filter === option ? 'active' : ''} onClick={() => setFilter(option)}>{option[0].toUpperCase() + option.slice(1)}</button>)}</div></div>
      {visibleInvoices.length === 0 ? <p className="empty-state">No invoices match this filter.</p> : visibleInvoices.map(invoice => <article className="invoice-row" key={invoice.id}>
        <div><h2>{invoice.client_name}</h2><p className="muted">Invoice #{invoice.invoice_number || invoice.id} · Due {new Date(invoice.due_date).toLocaleDateString()}</p><p className="last-ping">{invoice.pings_sent ? `Last ping · ${invoice.pings_sent} sent` : 'No pings sent yet'}</p></div>
        <strong className="invoice-amount">${(invoice.amount_cents / 100).toFixed(2)}</strong>
        <span className={`status-pill status-${invoice.status}`}>{invoice.status}</span>
        <div className="invoice-actions">{invoice.status !== 'paid' && <button className="action-button" onClick={() => ping(invoice.id)}>Ping now</button>}<button className="action-button" onClick={() => markPaid(invoice.id)}>Mark paid</button></div>
      </article>)}
    </section>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </main>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [pendingVerification, setPendingVerification] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [verificationConfirmed] = useState(() => new URLSearchParams(window.location.search).get('verified') === 'success');
  const [view, setView] = useState(() => {
    if (window.location.hash === '#login') return 'login';
    if (window.location.hash === '#register') return 'register';
    if (window.location.hash === '#onboarding') return 'onboarding';
    return 'landing';
  });

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then(response => response.ok ? response.json() : null)
      .then(setUser)
      .finally(() => setAuthLoading(false));
    const syncView = () => {
      if (window.location.hash === '#login') setView('login');
      else if (window.location.hash === '#register') setView('register');
      else if (window.location.hash === '#onboarding') setView('onboarding');
      else setView('landing');
    };
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  if (authLoading) return <main className="auth-loading" aria-label="Loading PingFox">Loading PingFox…</main>;
  if (user && !user.onboarding_complete) return <Onboarding user={user} onComplete={setUser} showConfirmation={verificationConfirmed} />;
  if (user) return <Dashboard user={user} onLogout={() => { setUser(null); setView('landing'); }} />;
  if (pendingVerification) return <VerifyEmail email={pendingVerification.email} onBackToLanding={() => { setPendingVerification(null); window.location.hash = ''; setView('landing'); }} />;
  if (view === 'login') return <Login onLogin={setUser} onRegister={() => { window.location.hash = 'register'; }} onBackToLanding={() => { window.location.hash = ''; setView('landing'); }} />;
  if (view === 'register') return <Register onRegister={data => { setPendingVerification(data); setView('verify'); }} onBackToLanding={() => { window.location.hash = ''; setView('landing'); }} />;
  return <Landing onStart={() => { window.location.hash = 'login'; setView('login'); }} />;
}
