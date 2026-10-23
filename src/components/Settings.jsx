import { useState } from 'react';
import { FoxMark } from './Brand';
import { Toast } from './Toast';

const initialInvoiceSettings = {
  logo: '',
  cancellationDescription: 'You can cancel an invoice reminder before the next ping is sent.',
  paymentDescription: 'Thanks for your payment.',
};

export function Settings({ user, onBack, onSaved }) {
  const [form, setForm] = useState({
    full_name: user.full_name || '', business_name: user.business_name || '', phone: user.phone || '', tax_id: '',
    residence_address: user.residence_address || '', city: user.city || '', region: user.region || '', postal_code: user.postal_code || '',
    country: user.country || '', timezone: user.timezone || 'UTC',
  });
  const [invoiceSettings, setInvoiceSettings] = useState(() => {
    try { return { ...initialInvoiceSettings, ...JSON.parse(localStorage.getItem('pingfox_invoice_settings') || '{}') }; }
    catch { return initialInvoiceSettings; }
  });
  const [logoPreview, setLogoPreview] = useState(invoiceSettings.logo);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  function updateField(event) { setForm(current => ({ ...current, [event.target.name]: event.target.value })); }
  function updateInvoiceSetting(event) { setInvoiceSettings(current => ({ ...current, [event.target.name]: event.target.value })); }
  function chooseLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setLogoPreview(reader.result); setInvoiceSettings(current => ({ ...current, logo: reader.result })); };
    reader.readAsDataURL(file);
  }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch('/api/onboarding', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    if (!response.ok) { setToast({ message: 'Could not save your account settings.', critical: true }); setSaving(false); return; }
    const savedUser = await response.json();
    localStorage.setItem('pingfox_invoice_settings', JSON.stringify(invoiceSettings));
    onSaved(savedUser);
    setToast({ message: 'Settings saved.' });
    setSaving(false);
  }

  return <main className="dashboard-shell settings-shell">
    <header className="topbar"><div><FoxMark /><span className="brand">PingFox</span></div><button className="quiet-button" type="button" onClick={onBack}>Back to invoices</button></header>
    <section className="dashboard-heading settings-heading"><div><p className="eyebrow">Workspace preferences</p><h1>Settings</h1><p className="dashboard-subtitle">Keep your account and invoice messages up to date.</p></div></section>
    <form className="settings-grid" onSubmit={save}>
      <section className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">Account</p><h2>Business profile</h2></div><span className="settings-badge">Private</span></div>
        <div className="form-grid"><label>Full name<input name="full_name" value={form.full_name} onChange={updateField} required /></label><label>Business name<input name="business_name" value={form.business_name} onChange={updateField} /></label><label>Phone<input name="phone" value={form.phone} onChange={updateField} /></label><label>Tax ID<input name="tax_id" value={form.tax_id} onChange={updateField} /></label></div>
        <label>Residence address<input name="residence_address" value={form.residence_address} onChange={updateField} required /></label>
        <div className="form-grid"><label>City<input name="city" value={form.city} onChange={updateField} /></label><label>Region<input name="region" value={form.region} onChange={updateField} /></label><label>Postal code<input name="postal_code" value={form.postal_code} onChange={updateField} /></label><label>Country<input name="country" value={form.country} onChange={updateField} required /></label></div>
        <label>Login email<input value={user.email} readOnly /></label>
      </section>
      <section className="settings-card"><div className="settings-card-heading"><div><p className="eyebrow">Branding</p><h2>Invoice appearance</h2></div></div>
        <label>Logo<span className="logo-picker">{logoPreview ? <img src={logoPreview} alt="Invoice logo preview" /> : <span className="logo-placeholder"><FoxMark /></span>}<span><strong>Upload a logo</strong><small>PNG, JPG, or SVG · shown on invoice emails</small></span><input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={chooseLogo} /></span></label>
        <label>Cancellation description<textarea name="cancellationDescription" value={invoiceSettings.cancellationDescription} onChange={updateInvoiceSetting} rows="4" /></label>
        <label>Payment confirmation description<textarea name="paymentDescription" value={invoiceSettings.paymentDescription} onChange={updateInvoiceSetting} rows="4" /></label>
        <div className="settings-actions"><button className="quiet-button" type="button" onClick={onBack}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></div>
      </section>
    </form>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </main>;
}
