import { useEffect, useMemo, useState } from 'react';
import { FoxMark } from './Brand';
import { Toast } from './Toast';

export function AdminPanel({ user, onBack }) {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  async function load() {
    const response = await fetch('/api/admin/overview', { credentials: 'include' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || body.error || 'Could not load the admin panel.');
    setData(body);
  }

  useEffect(() => { load().catch(loadError => setError(loadError.message)); }, []);

  async function setStatus(account, status) {
    const response = await fetch(`/api/admin/accounts/${account.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status }) });
    const body = await response.json();
    if (!response.ok) { setToast({ message: body.error || 'Could not update account.', critical: true }); return; }
    setData(current => ({ ...current, accounts: current.accounts.map(item => item.id === account.id ? body.account : item) }));
    setToast({ message: `${account.email} is now ${status}.` });
  }

  async function deleteAccount(account) {
    if (!window.confirm(`Permanently delete ${account.email}? This removes the account, invoices, and subscription history.`)) return;
    const response = await fetch(`/api/admin/accounts/${account.id}`, { method: 'DELETE', credentials: 'include' });
    const body = await response.json();
    if (!response.ok) { setToast({ message: body.error || 'Could not delete account.', critical: true }); return; }
    setData(current => ({ ...current, accounts: current.accounts.filter(item => item.id !== account.id), metrics: { ...current.metrics, total_accounts: current.metrics.total_accounts - 1 } }));
    setToast({ message: 'Account permanently deleted.' });
  }

  async function requestEmailChange(account) {
    const newEmail = window.prompt(`New email address for ${account.email}:`);
    if (!newEmail) return;
    const response = await fetch(`/api/admin/accounts/${account.id}/email-change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ new_email: newEmail.trim() }) });
    const body = await response.json();
    setToast(response.ok ? { message: 'Confirmation sent to the current email address.' } : { message: body.error || 'Could not request the email change.', critical: true });
  }

  const accounts = useMemo(() => (data?.accounts || []).filter(account => [account.email, account.full_name, account.business_name].join(' ').toLowerCase().includes(query.toLowerCase())), [data, query]);
  if (error) return <main className="dashboard-shell"><div className="error-box"><span className="dot" />{error}</div><button className="quiet-button" type="button" onClick={onBack}>← Back to workspace</button></main>;
  if (!data) return <main className="auth-loading" aria-label="Loading admin panel">Loading admin panel…</main>;

  const metrics = data.metrics;
  return <main className="dashboard-shell">
    <header className="topbar"><div><FoxMark /><span className="brand">PingFox Admin</span></div><div className="dashboard-nav"><button className="quiet-button" type="button" onClick={onBack}>Workspace</button></div></header>
    <section className="dashboard-heading"><div><p className="eyebrow">Operations</p><h1>Admin overview</h1><p className="dashboard-subtitle">Monitor account health and take controlled support actions.</p></div></section>
    <section className="admin-metrics" aria-label="Account metrics">
      <Metric label="Total accounts" value={metrics.total_accounts} /><Metric label="Free accounts" value={metrics.free_accounts} /><Metric label="Paying accounts" value={metrics.paying_accounts} /><Metric label="Estimated MRR" value={`$${(metrics.estimated_mrr_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`} /><Metric label="Verified" value={metrics.verified_accounts} /><Metric label="Invoices" value={metrics.total_invoices} />
    </section>
    <section className="invoice-card admin-accounts"><div className="invoice-card-toolbar"><strong>Accounts</strong><input className="admin-search" aria-label="Search accounts" placeholder="Search accounts" value={query} onChange={event => setQuery(event.target.value)} /></div>
      {accounts.length === 0 ? <p className="empty-state">No accounts match this search.</p> : accounts.map(account => <article className="admin-account-row" key={account.id}><div><h2>{account.business_name || account.full_name || 'Unnamed account'}</h2><p className="muted">{account.email} · {account.plan} · {account.invoice_count} invoices</p><p className="last-ping">{account.email_verified ? 'Email verified' : 'Email unverified'} · Account {account.account_status}</p></div><span className={`status-pill status-${account.account_status === 'active' ? 'paid' : 'overdue'}`}>{account.account_status}</span><div className="invoice-actions">{account.id !== user.user_id && <>{account.account_status === 'suspended' ? <button className="action-button" type="button" onClick={() => setStatus(account, 'active')}>Restore</button> : <button className="action-button" type="button" onClick={() => setStatus(account, 'suspended')}>Suspend</button>}{account.account_status !== 'closed' && <button className="action-button" type="button" onClick={() => setStatus(account, 'closed')}>Close</button>}<button className="action-button" type="button" onClick={() => requestEmailChange(account)}>Change email</button><button className="danger-button admin-delete" type="button" onClick={() => deleteAccount(account)}>Delete</button></>}</div></article>)}
    </section>
    <p className="admin-note">Estimated MRR uses the configured plan prices and active accounts. Connect Stripe billing before treating it as recognized revenue.</p>
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </main>;
}

function Metric({ label, value }) {
  return <div className="dashboard-summary-item"><span>{label}</span><strong>{value}</strong></div>;
}
