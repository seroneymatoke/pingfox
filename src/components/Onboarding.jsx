import { useState } from 'react';
import { FoxMark } from './Brand';

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
