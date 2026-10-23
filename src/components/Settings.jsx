import { useEffect, useState } from 'react';
import { FoxMark } from './Brand';
import { Toast } from './Toast';

const tabs = [
  ['business', 'Business'], ['profile', 'Profile'], ['security', 'Security'],
  ['subscription', 'Subscription'], ['notifications', 'Notifications'], ['invoices', 'Invoices'], ['privacy', 'Privacy'],
];

const defaults = {
  logo: '', cancellationDescription: 'You can cancel an invoice reminder before the next ping is sent.',
  paymentDescription: 'Thanks for your payment.', invoiceTerms: 'Payment is due by the date shown on this invoice.', paymentReceived: true, reminderSent: true, deliveryFailed: true, announcements: true,
};
const sampleLogo = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Crect width="64" height="64" rx="16" fill="%23212634"/%3E%3Cpath d="M16 44 23 18l9 8 9-8 7 26-16-7-16 7Z" fill="%23ff6b3d"/%3E%3Ccircle cx="28" cy="34" r="3" fill="%23f3f1ec"/%3E%3Ccircle cx="39" cy="34" r="3" fill="%23f3f1ec"/%3E%3C/svg%3E';

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
  const [preferences, setPreferences] = useState(() => { const saved = storedSettings(); return { ...saved, logo: user.business_logo || saved.logo, invoiceTerms: user.invoice_terms || saved.invoiceTerms, paymentTerms: user.payment_terms || saved.paymentTerms, cancellationDescription: user.cancellation_description || saved.cancellationDescription, paymentDescription: user.payment_description || saved.paymentDescription }; });
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [subscription, setSubscription] = useState({ plan: user.plan, status: user.subscription_status || 'active', cancel_at: user.subscription_cancel_at, history: [] });
  const [previewMode, setPreviewMode] = useState('pdf');
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
    try { const body = await request('/api/settings/profile', { method: 'PUT', body: JSON.stringify({ ...profile, business_logo: preferences.logo }) }); localStorage.setItem('pingfox_settings', JSON.stringify(preferences)); onSaved(body); setToast({ message: 'Business settings saved.' }); }
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

  async function saveInvoicePreferences(event) {
    event.preventDefault(); setSaving(true);
    try { const body = await request('/api/settings/invoice', { method: 'PUT', body: JSON.stringify({ business_logo: preferences.logo, invoice_terms: preferences.invoiceTerms, payment_terms: preferences.paymentTerms, cancellation_description: preferences.cancellationDescription, payment_description: preferences.paymentDescription }) }); localStorage.setItem('pingfox_settings', JSON.stringify(preferences)); onSaved(body); setToast({ message: 'Invoice settings saved.' }); }
    catch (error) { setToast({ message: error.message, critical: true }); }
    setSaving(false);
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
      {tab === 'business' && <form className="settings-card settings-panel" onSubmit={saveProfile}><Section eyebrow="Business" title="Business profile" description="Details used on your workspace and invoice communications." /><div className="form-grid"><Field label="Full name" name="full_name" value={profile.full_name} onChange={updateProfile} required /><Field label="Business name" name="business_name" value={profile.business_name} onChange={updateProfile} /><Field label="Phone" name="phone" value={profile.phone} onChange={updateProfile} /><Field label="Tax ID" name="tax_id" value={profile.tax_id} onChange={updateProfile} /></div><label>Business logo<span className="logo-picker">{preferences.logo ? <img src={preferences.logo} alt="Business logo preview" /> : <span className="logo-placeholder"><FoxMark /></span>}<span><strong>Upload your business logo</strong><small>PNG, JPG, or SVG · used on invoice emails</small></span><input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={logoSelected} /></span></label><Field label="Residence / business address" name="residence_address" value={profile.residence_address} onChange={updateProfile} required /><div className="form-grid"><Field label="City" name="city" value={profile.city} onChange={updateProfile} /><Field label="Region" name="region" value={profile.region} onChange={updateProfile} /><Field label="Postal code" name="postal_code" value={profile.postal_code} onChange={updateProfile} /><Field label="Country" name="country" value={profile.country} onChange={updateProfile} required /></div><Field label="Timezone" name="timezone" value={profile.timezone} onChange={updateProfile} /><SaveButton saving={saving} label="Save business settings" /></form>}
      {tab === 'profile' && <section className="settings-card settings-panel"><Section eyebrow="Profile" title="Profile and login email" description="Your login email is protected and cannot be changed from Settings." /><label>Login email<input type="email" value={user.email} readOnly disabled /></label><p className="settings-help">Need to correct this address? Contact an administrator. They will send a confirmation link to your current email before the change can proceed.</p></section>}
      {tab === 'security' && <form className="settings-card settings-panel" onSubmit={savePassword}><Section eyebrow="Security" title="Change password" description="Use at least 8 characters and never reuse a password from another service." /><Field label="Current password" type="password" name="current_password" value={passwords.current_password} onChange={updatePassword} required /><div className="form-grid"><Field label="New password" type="password" name="new_password" minLength="8" value={passwords.new_password} onChange={updatePassword} required /><Field label="Confirm new password" type="password" name="confirm_password" minLength="8" value={passwords.confirm_password} onChange={updatePassword} required /></div><SaveButton saving={saving} label="Change password" /></form>}
      {tab === 'subscription' && <section className="settings-card settings-panel"><Section eyebrow="Billing" title="Subscription" description="Review your current plan and manage your billing lifecycle." /><div className="subscription-summary"><div><span>Current plan</span><strong>{subscription.plan[0].toUpperCase() + subscription.plan.slice(1)}</strong></div><div><span>Status</span><strong>{subscription.status === 'cancel_at_period_end' ? 'Cancels at period end' : subscription.status}</strong></div></div>{subscription.plan === 'free' && <div className="upgrade-card"><div><p className="eyebrow">Recommended</p><h3>Starter · $19/month</h3><p>Up to 25 active invoices, custom ping sequences, email and SMS pings, and Stripe and QuickBooks sync.</p></div><button className="primary-button" type="button" disabled={saving} onClick={requestStarterUpgrade}>{saving ? 'Requesting…' : 'Upgrade to Starter'}</button></div>}<div className="history-card"><strong>Subscription history</strong>{subscription.history?.length ? <ul className="history-list">{subscription.history.map(event => <li key={`${event.event}-${event.created_at}`}><span>{event.event.replaceAll('_', ' ')}</span><small>{new Date(event.created_at).toLocaleDateString()}</small></li>)}</ul> : <p className="muted">No subscription events have been recorded yet.</p>}</div>{subscription.plan !== 'free' && <button className="danger-button" type="button" disabled={saving || subscription.status === 'cancel_at_period_end'} onClick={cancelSubscription}>{subscription.status === 'cancel_at_period_end' ? 'Cancellation scheduled' : 'Cancel subscription'}</button>}</section>}
      {tab === 'notifications' && <form className="settings-card settings-panel" onSubmit={savePreferences}><Section eyebrow="Notifications" title="Email notifications" description="Choose which workspace updates PingFox sends to you." /><Toggle name="paymentReceived" checked={preferences.paymentReceived} onChange={updatePreference}>Payment received</Toggle><Toggle name="reminderSent" checked={preferences.reminderSent} onChange={updatePreference}>Reminder sent</Toggle><Toggle name="deliveryFailed" checked={preferences.deliveryFailed} onChange={updatePreference}>Delivery failed</Toggle><Toggle name="announcements" checked={preferences.announcements} onChange={updatePreference}>Product announcements</Toggle><SaveButton saving={false} label="Save notification settings" /></form>}
      {tab === 'invoices' && <form className="settings-card settings-panel" onSubmit={saveInvoicePreferences}><Section eyebrow="Invoices" title="Invoice defaults" description="Customize the messages clients see around invoice reminders." /><label>Business logo<span className="logo-picker">{preferences.logo ? <img src={preferences.logo} alt="Business logo preview" /> : <span className="logo-placeholder"><FoxMark /></span>}<span><strong>Upload your business logo</strong><small>PNG, JPG, or SVG · shown on invoice emails</small></span><input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={logoSelected} /></span></label><label>Invoice terms<textarea name="invoiceTerms" value={preferences.invoiceTerms} onChange={updatePreference} rows="4" /></label><label>Default payment terms<input name="paymentTerms" value={preferences.paymentTerms} onChange={updatePreference} /></label><label>Cancellation description<textarea name="cancellationDescription" value={preferences.cancellationDescription} onChange={updatePreference} rows="4" /></label><label>Payment confirmation description<textarea name="paymentDescription" value={preferences.paymentDescription} onChange={updatePreference} rows="4" /></label><InvoicePreview mode={previewMode} onModeChange={setPreviewMode} preferences={preferences} profile={profile} /><SaveButton saving={saving} label="Save invoice settings" /></form>}
      {tab === 'privacy' && <section className="settings-card settings-panel"><Section eyebrow="Privacy" title="Privacy and data" description="Your private profile fields are encrypted at rest." /><div className="privacy-links"><a href="#terms">Terms of Service</a><a href="#privacy">Privacy Policy</a><button type="button" onClick={() => setToast({ message: 'Data export will be available soon.' })}>Request data export</button><button className="danger-button" type="button" onClick={() => setToast({ message: 'Account deletion requires a support confirmation.', critical: true })}>Delete account</button></div></section>}
    </div>{toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </main>;
}

function Section({ eyebrow, title, description }) { return <div className="settings-card-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="settings-description">{description}</p></div></div>; }
function SaveButton({ saving, label }) { return <div className="settings-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : label}</button></div>; }
function Toggle({ name, checked, onChange, children }) { return <label className="settings-toggle"><input type="checkbox" name={name} checked={checked} onChange={onChange} /><span>{children}</span></label>; }

function PoweredByFooter() { return <div className="powered-by"><FoxMark /><span>Powered by <strong>PingFox</strong></span></div>; }

function InvoicePreview({ mode, onModeChange, preferences, profile }) {
  const previewLogo = preferences.logo || sampleLogo;
  const previewBusiness = profile.business_name || 'Northstar Studio';
  const previewPaymentLink = 'https://pingfox.com/api/pay/preview_8f2a9c1e7b6d4a90';
  return <section className="invoice-preview" aria-label="Invoice preview">
    <div className="invoice-preview-heading"><div><p className="eyebrow">Preview</p><h3>See how clients will receive it</h3></div><div className="preview-actions"><button type="button" className={mode === 'pdf' ? 'active' : ''} onClick={() => onModeChange('pdf')}>PDF</button><button type="button" className={mode === 'email' ? 'active' : ''} onClick={() => onModeChange('email')}>Email</button></div></div>
    {mode === 'pdf' ? <div className="pdf-preview"><div className="pdf-preview-toolbar"><span>invoice-preview.pdf</span><button type="button" onClick={() => window.print()}>Print / save PDF</button></div><div className="invoice-paper"><div className="invoice-paper-header"><img src={previewLogo} alt="" /><div><strong>{previewBusiness}</strong><span>INVOICE #1042</span></div></div><div className="invoice-paper-meta"><div><small>FROM</small><strong>{previewBusiness}</strong><span>Invoice sender</span></div><div><small>BILLED TO</small><strong>Marigold Studio</strong><span>client@example.com</span></div><div><small>DUE DATE</small><strong>November 21, 2026</strong><span>{preferences.paymentTerms}</span></div></div><div className="invoice-paper-line"><span>Invoice follow-up service</span><strong>$2,400.00</strong></div><div className="invoice-paper-total"><span>Total due</span><strong>$2,400.00</strong></div><p className="invoice-paper-terms"><strong>Terms</strong>{preferences.invoiceTerms}</p><PoweredByFooter /></div></div> : <div className="email-preview"><div className="email-window-bar"><span /> <span /> <span /> <small>PingFox · Invoice reminder</small></div><div className="email-message"><div className="email-brand"><img src={previewLogo} alt="" /><strong>{previewBusiness}</strong></div><p>Hi Marigold Studio,</p><p>You’re receiving this invoice from <strong>{previewBusiness}</strong>. Invoice <strong>#1042</strong> is ready, with an outstanding balance of <strong>$2,400.00</strong>.</p><a className="email-pay-button" href={previewPaymentLink}>View and pay invoice</a><p className="email-copy">{preferences.cancellationDescription}</p><small className="email-link">Secure payment link: {previewPaymentLink}</small><small>{preferences.paymentDescription}</small><PoweredByFooter /></div></div>}
  </section>;
}
