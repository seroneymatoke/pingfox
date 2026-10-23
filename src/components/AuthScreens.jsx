import { useState } from 'react';
import { FoxMark, OAuthButton } from './Brand';

export function Login({ onLogin, onRegister, onBackToLanding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [oauthMessage, setOauthMessage] = useState(() => new URLSearchParams(window.location.search).get('oauth_error') || '');

  function startGoogleLogin() {
    window.location.href = '/api/oauth/google/start?mode=login';
  }

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
    <div className="oauth-actions"><OAuthButton provider="Google" onClick={startGoogleLogin} /><OAuthButton provider="Facebook" onClick={() => setOauthMessage('Facebook sign-in will be available soon.')} /><OAuthButton provider="Microsoft" onClick={() => setOauthMessage('Microsoft sign-in will be available soon.')} /></div>
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

  function startGoogleRegistration() {
    if (!termsAccepted || !privacyAccepted) {
      setError('Agree to the Terms of Service and Privacy Policy before continuing with Google.');
      return;
    }
    window.location.href = '/api/oauth/google/start?mode=register';
  }

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
    <div className="oauth-actions"><OAuthButton provider="Google" onClick={startGoogleRegistration} /><OAuthButton provider="Facebook" onClick={() => setError('Facebook sign-in will be available soon.')} /><OAuthButton provider="Microsoft" onClick={() => setError('Microsoft sign-in will be available soon.')} /></div>
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

