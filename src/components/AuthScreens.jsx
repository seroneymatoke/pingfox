import { useState } from 'react';
import { FoxMark, OAuthButton } from './Brand';

export function Login({ onLogin, onRegister, onBackToLanding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [oauthMessage, setOauthMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, password }) });
    if (!response.ok) {
      setError((await response.json()).error || 'Could not log in.');
      return;
    }
    onLogin(await response.json());
  }

  return <main className="auth-shell"><section className="auth-card">
    <button type="button" className="auth-brand auth-brand-link" onClick={onBackToLanding} aria-label="Back to PingFox landing page"><FoxMark /><span>PingFox</span></button>
    <p className="auth-kicker">Welcome back</p><h1>Keep the cash moving.</h1>
    <p className="auth-subtitle">Log in to your invoice workspace and let PingFox handle the follow-up.</p>
    {error && <div className="error-box"><span className="dot" />{error}</div>}
    {oauthMessage && <div className="oauth-note">{oauthMessage}</div>}
    <form onSubmit={submit} className="stack-form">
      <label>Email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="primary-button" type="submit">Log in <span aria-hidden="true">→</span></button>
    </form>
    <div className="auth-divider"><span>or continue with</span></div>
    <div className="oauth-actions"><OAuthButton provider="Google" onClick={() => setOauthMessage('Google sign-in will be available soon.')} /><OAuthButton provider="Facebook" onClick={() => setOauthMessage('Facebook sign-in will be available soon.')} /><OAuthButton provider="Microsoft" onClick={() => setOauthMessage('Microsoft sign-in will be available soon.')} /></div>
    <p className="auth-footer">New to PingFox? <button type="button" onClick={onRegister}>Start free</button></p>
    <button type="button" className="back-to-landing" onClick={onBackToLanding}>← Back to landing page</button>
  </section></main>;
}

export function Register({ onRegister, onBackToLanding }) {
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
    const response = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, password, terms_accepted: termsAccepted, privacy_accepted: privacyAccepted }) });
    if (!response.ok) {
      setError((await response.json()).error || 'Could not create your account.');
      return;
    }
    onRegister(await response.json());
  }

  return <main className="auth-shell"><section className="auth-card">
    <button type="button" className="auth-brand auth-brand-link" onClick={onBackToLanding} aria-label="Back to PingFox landing page"><FoxMark /><span>PingFox</span></button>
    <p className="auth-kicker">Start for free</p><h1>Get paid without the awkwardness.</h1>
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
  </section></main>;
}

export function VerifyEmail({ email, onBackToLanding }) {
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

export function Onboarding({ user, onComplete, showConfirmation = false }) {
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
