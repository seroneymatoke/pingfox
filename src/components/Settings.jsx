import { useEffect, useState } from 'react';
import { FoxMark } from './Brand';
import { Toast } from './Toast';

const tabs = [
  ['business', 'Business'], ['profile', 'Profile'], ['security', 'Security'],
  ['subscription', 'Subscription'], ['notifications', 'Notifications'], ['invoices', 'Invoices'], ['privacy', 'Privacy'],
];

const defaults = {
  logo: '', cancellationDescription: 'You can cancel an invoice reminder before the next ping is sent.',
  paymentDescription: 'Thanks for your payment.', paymentReceived: true, reminderSent: true, deliveryFailed: true, announcements: true,
};

function storedSettings() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('pingfox_settings') || '{}') }; }
  catch { return defaults; }
}

function Field({ label, name, value, onChange, ...props }) {
  return <label>{label}<input name={name} value={value} onChange={onChange} {...props} /></label>;
}

export function Settings({ user, onBack, onSaved, initialTab = 'business' }) {
  const [tab, setTab] = useState(initialTab);
  const [profile, setProfile] = useState({ full_name: user.full_name || '', business_name: user.business_name || '', phone: user.phone || '', tax_id: '', residence_address: user.residence_address || '', city: user.city || '', region: user.region || '', postal_code: user.postal_code || '', country: user.country || '', timezone: user.timezone || 'UTC' });
  const [preferences, setPreferences] = useState(storedSettings);
  const [email, setEmail] = useState(user.email);
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [subscription, setSubscription] = useState({ plan: user.plan, status: user.subscription_status || 'active', cancel_at: user.subscription_cancel_at, history: [] });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (tab !== 'subscription') return;
    fetch('/api/subscription', { credentials: 'include' }).then(response => response.ok ? response.json() : null).then(body => { if (body) setSubscription(body); });
  }, [tab]);

  const updateProfile = event => setProfile(current => ({ ...current, [event.target.name]: event.target.value }));
  const updatePassword = event => setPasswords(current => ({ ...current, [event.target.name]: event.target.value }));
  const updatePreference = event => setPreferences(current => ({ ...current, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not save your settings.');
    return body;
  }

  async function saveProfile(event) {
    event.preventDefault(); setSaving(true);
    try { const body = await request('/api/settings/profile', { method: 'PUT', body: JSON.stringify(profile) }); onSaved(body); setToast({ message: 'Business settings saved.' }); }
    catch (error) { setToast({ message: error.message, critical: true }); }
    setSaving(false);
  }

  async function saveEmail(event) {
    event.preventDefault(); setSaving(true);
    try { const body = await request('/api/settings/email', { method: 'PUT', body: JSON.stringify({ email, current_password: passwords.current_password }) }); onSaved(body); setPasswords(current => ({ ...current, current_password: '' })); setToast({ message: 'Email address updated.' }); }
    catch (error) { setToast({ message: error.message, critical: true }); }
    setSaving(false);
  }

  async function savePassword(event) {
    event.preventDefault();
    if (passwords.new_password !== passwords.confirm_password) { setToast({ message: 'New passwords do not match.', critical: true }); return; }
    setSaving(true);
    try { await request('/api/settings/password', { method: 'PUT', body: JSON.stringify(passwords) }); setPasswords({ current_password: '', new_password: '', confirm_password: '' }); setToast({ message: 'Password updated successfully.' }); }
    catch (error) { setToast({ message: error.message, critical: true }); }
    setSaving(false);
  }

  function savePreferences(event) {
    event.preventDefault(); localStorage.setItem('pingfox_settings', JSON.stringify(preferences)); setToast({ message: 'Preferences saved.' });
  }

  async function cancelSubscription() {
    if (!window.confirm('Cancel your subscription at the end of the current billing period?')) return;
    setSaving(true);
    try { const body = await request('/api/subscription/cancel', { method: 'POST' }); setSubscription(body); setToast({ message: 'Your subscription will cancel at the end of the billing period.' }); }
    catch (error) { setToast({ message: error.message, critical: true }); }
    setSaving(false);
  }

  async function requestStarterUpgrade() {
    setSaving(true);
    try { const body = await request('/api/subscription/upgrade', { method: 'POST', body: JSON.stringify({ plan: 'starter' }) }); setToast({ message: body.message }); setSubscription(current => ({ ...current, status: body.status, history: [{ event: 'upgrade_requested', plan: 'starter', created_at: new Date().toISOString() }, ...(current.history || [])] })); }
    catch (error) { setToast({ message: error.message, critical: true }); }
    setSaving(false);
  }

  function logoSelected(event) {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setPreferences(current => ({ ...current, logo: reader.result })); reader.readAsDataURL(file);
  }

  return <main className="dashboard-shell settings-shell">
    <header className="topbar"><div><FoxMark /><span className="brand">PingFox</span></div><button className="quiet-button" type="button" onClick={onBack}>Back to invoices</button></header>
    <section className="dashboard-heading settings-heading"><div><p className="eyebrow">Workspace preferences</p><h1>Settings</h1><p className="dashboard-subtitle">Manage your workspace, account, billing, and communication preferences.</p></div></section>
    <div className="settings-layout"><nav className="settings-tabs" aria-label="Settings sections">{tabs.map(([key, label]) => <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
      {tab === 'business' && <form className="settings-card settings-panel" onSubmit={saveProfile}><Section eyebrow="Business" title="Business profile" description="Details used on your workspace and invoice communications." /><div className="form-grid"><Field label="Full name" name="full_name" value={profile.full_name} onChange={updateProfile} required /><Field label="Business name" name="business_name" value={profile.business_name} onChange={updateProfile} /><Field label="Phone" name="phone" value={profile.phone} onChange={updateProfile} /><Field label="Tax ID" name="tax_id" value={profile.tax_id} onChange={updateProfile} /></div><Field label="Residence / business address" name="residence_address" value={profile.residence_address} onChange={updateProfile} required /><div className="form-grid"><Field label="City" name="city" value={profile.city} onChange={updateProfile} /><Field label="Region" name="region" value={profile.region} onChange={updateProfile} /><Field label="Postal code" name="postal_code" value={profile.postal_code} onChange={updateProfile} /><Field label="Country" name="country" value={profile.country} onChange={updateProfile} required /></div><Field label="Timezone" name="timezone" value={profile.timezone} onChange={updateProfile} /><SaveButton saving={saving} label="Save business settings" /></form>}
      {tab === 'profile' && <form className="settings-card settings-panel" onSubmit={saveEmail}><Section eyebrow="Profile" title="Profile and login email" description="Your email must be unique and is used for account access." /><Field label="Login email" type="email" name="email" value={email} onChange={event => setEmail(event.target.value)} required /><Field label="Current password" type="password" name="current_password" value={passwords.current_password} onChange={updatePassword} required /><SaveButton saving={saving} label="Update email" /></form>}
      {tab === 'security' && <form className="settings-card settings-panel" onSubmit={savePassword}><Section eyebrow="Security" title="Change password" description="Use at least 8 characters and never reuse a password from another service." /><Field label="Current password" type="password" name="current_password" value={passwords.current_password} onChange={updatePassword} required /><div className="form-grid"><Field label="New password" type="password" name="new_password" minLength="8" value={passwords.new_password} onChange={updatePassword} required /><Field label="Confirm new password" type="password" name="confirm_password" minLength="8" value={passwords.confirm_password} onChange={updatePassword} required /></div><SaveButton saving={saving} label="Change password" /></form>}
      {tab === 'subscription' && <section className="settings-card settings-panel"><Section eyebrow="Billing" title="Subscription" description="Review your current plan and manage your billing lifecycle." /><div className="subscription-summary"><div><span>Current plan</span><strong>{subscription.plan[0].toUpperCase() + subscription.plan.slice(1)}</strong></div><div><span>Status</span><strong>{subscription.status === 'cancel_at_period_end' ? 'Cancels at period end' : subscription.status}</strong></div></div>{subscription.plan === 'free' && <div className="upgrade-card"><div><p className="eyebrow">Recommended</p><h3>Starter · $19/month</h3><p>Up to 25 active invoices, custom ping sequences, email and SMS pings, and Stripe and QuickBooks sync.</p></div><button className="primary-button" type="button" disabled={saving} onClick={requestStarterUpgrade}>{saving ? 'Requesting…' : 'Upgrade to Starter'}</button></div>}<div className="history-card"><strong>Subscription history</strong>{subscription.history?.length ? <ul className="history-list">{subscription.history.map(event => <li key={`${event.event}-${event.created_at}`}><span>{event.event.replaceAll('_', ' ')}</span><small>{new Date(event.created_at).toLocaleDateString()}</small></li>)}</ul> : <p className="muted">No subscription events have been recorded yet.</p>}</div>{subscription.plan !== 'free' && <button className="danger-button" type="button" disabled={saving || subscription.status === 'cancel_at_period_end'} onClick={cancelSubscription}>{subscription.status === 'cancel_at_period_end' ? 'Cancellation scheduled' : 'Cancel subscription'}</button>}</section>}
      {tab === 'notifications' && <form className="settings-card settings-panel" onSubmit={savePreferences}><Section eyebrow="Notifications" title="Email notifications" description="Choose which workspace updates PingFox sends to you." /><Toggle name="paymentReceived" checked={preferences.paymentReceived} onChange={updatePreference}>Payment received</Toggle><Toggle name="reminderSent" checked={preferences.reminderSent} onChange={updatePreference}>Reminder sent</Toggle><Toggle name="deliveryFailed" checked={preferences.deliveryFailed} onChange={updatePreference}>Delivery failed</Toggle><Toggle name="announcements" checked={preferences.announcements} onChange={updatePreference}>Product announcements</Toggle><SaveButton saving={false} label="Save notification settings" /></form>}
      {tab === 'invoices' && <form className="settings-card settings-panel" onSubmit={savePreferences}><Section eyebrow="Invoices" title="Invoice defaults" description="Customize the messages clients see around invoice reminders." /><label>Logo<span className="logo-picker">{preferences.logo ? <img src={preferences.logo} alt="Invoice logo preview" /> : <span className="logo-placeholder"><FoxMark /></span>}<span><strong>Upload a logo</strong><small>PNG, JPG, or SVG · shown on invoice emails</small></span><input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={logoSelected} /></span></label><label>Cancellation description<textarea name="cancellationDescription" value={preferences.cancellationDescription} onChange={updatePreference} rows="4" /></label><label>Payment confirmation description<textarea name="paymentDescription" value={preferences.paymentDescription} onChange={updatePreference} rows="4" /></label><SaveButton saving={false} label="Save invoice settings" /></form>}
      {tab === 'privacy' && <section className="settings-card settings-panel"><Section eyebrow="Privacy" title="Privacy and data" description="Your private profile fields are encrypted at rest." /><div className="privacy-links"><a href="#terms">Terms of Service</a><a href="#privacy">Privacy Policy</a><button type="button" onClick={() => setToast({ message: 'Data export will be available soon.' })}>Request data export</button><button className="danger-button" type="button" onClick={() => setToast({ message: 'Account deletion requires a support confirmation.', critical: true })}>Delete account</button></div></section>}
    </div>{toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </main>;
}

function Section({ eyebrow, title, description }) { return <div className="settings-card-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="settings-description">{description}</p></div></div>; }
function SaveButton({ saving, label }) { return <div className="settings-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : label}</button></div>; }
function Toggle({ name, checked, onChange, children }) { return <label className="settings-toggle"><input type="checkbox" name={name} checked={checked} onChange={onChange} /><span>{children}</span></label>; }
