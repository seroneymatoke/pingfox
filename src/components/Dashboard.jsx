import { useEffect, useState } from 'react';
import { FoxMark } from './Brand';
import { Toast } from './Toast';

export function Dashboard({ onLogout }) {
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
