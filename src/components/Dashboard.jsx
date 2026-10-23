import { useEffect, useState } from 'react';
import { FoxMark } from './Brand';
import { Settings } from './Settings';
import { Toast } from './Toast';

export function Dashboard({ user, onLogout, onUserUpdated }) {
  const [invoices, setInvoices] = useState([]);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('invoices');
  const [usage, setUsage] = useState({ plan: user.plan, invoicesCreated: 0, invoiceLimit: user.plan === 'free' ? 3 : null, canAddInvoice: true });

  async function loadInvoices() {
    const response = await fetch('/api/dashboard', { credentials: 'include' });
    if (response.ok) {
      const body = await response.json();
      setInvoices(body.invoices);
      setUsage({ plan: body.plan, invoicesCreated: body.invoices_created ?? body.invoices.length, invoiceLimit: body.invoice_limit, canAddInvoice: body.can_add_invoice ?? true });
    }
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

  function addInvoice() {
    if (!usage.canAddInvoice) { setView('settings'); return; }
    setToast({ message: 'Invoice creation is coming soon.' });
  }

  if (view === 'settings') return <Settings user={user} onBack={() => setView('invoices')} onSaved={onUserUpdated} initialTab={usage.canAddInvoice ? 'business' : 'subscription'} />;

  return <main className="dashboard-shell">
    <header className="topbar"><div><FoxMark /><span className="brand">PingFox</span></div><div className="dashboard-nav"><button className="quiet-button" type="button" onClick={() => setView('settings')}>Settings</button><button className="quiet-button" type="button" onClick={logout}>Log out</button></div></header>
    <section className="dashboard-heading"><div><p className="eyebrow">Your workspace</p><h1>Invoices</h1><p className="dashboard-subtitle">Keep every follow-up moving without chasing it yourself.</p>{usage.invoiceLimit && <p className="invoice-limit-note">{usage.invoicesCreated} of {usage.invoiceLimit} free invoices used · deleted invoices still count</p>}</div><button className="primary-button" type="button" onClick={addInvoice}>{usage.canAddInvoice ? 'Add invoice' : 'Request upgrade'}</button></section>
    {!usage.canAddInvoice && <div className="upgrade-alert" role="alert"><span><strong>Free tier reached.</strong> You’ve used all 3 lifetime free invoices. Upgrade to Starter to keep adding invoices.</span><button type="button" onClick={addInvoice}>View Starter</button></div>}
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
