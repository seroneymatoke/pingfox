import { useEffect, useState } from 'react';
import { FoxMark } from './Brand';

export function PublicInvoice({ token }) {
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    fetch(`/api/public/invoices/${encodeURIComponent(token)}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'This invoice could not be found.');
        return body;
      })
      .then(setInvoice)
      .catch(loadError => setError(loadError.message));
  }, [token]);

  async function payInvoice() {
    setPaying(true);
    const response = await fetch(`/api/pay/${encodeURIComponent(token)}`, { redirect: 'manual' });
    if (response.type === 'opaqueredirect' || response.status === 302 || response.status === 303) {
      window.location.assign(`/api/pay/${encodeURIComponent(token)}`);
      return;
    }
    const body = await response.json().catch(() => ({}));
    setError(body.message || 'Stripe checkout is not available yet.');
    setPaying(false);
  }

  if (error) return <main className="public-invoice-shell"><div className="public-invoice-card"><Brand /><p className="eyebrow">Invoice unavailable</p><h1>We couldn’t load this invoice.</h1><p className="public-invoice-muted">{error}</p><a className="quiet-button public-invoice-link" href="/">Return to PingFox</a></div></main>;
  if (!invoice) return <main className="auth-loading" aria-label="Loading invoice">Loading invoice…</main>;

  const paid = invoice.status === 'paid';
  return <main className="public-invoice-shell">
    <article className="public-invoice-card">
      <Brand />
      <div className="public-invoice-kicker">Invoice from {invoice.business_name}</div>
      <div className="public-invoice-heading"><div><p className="eyebrow">Invoice {invoice.invoice_number}</p><h1>{invoice.business_name} sent you an invoice.</h1></div>{invoice.business_logo ? <img src={invoice.business_logo} alt={`${invoice.business_name} logo`} /> : null}</div>
      <div className="public-invoice-summary"><span>For</span><strong>{invoice.client_name}</strong><span>Due</span><strong>{new Date(invoice.due_date).toLocaleDateString()}</strong><span>Total</span><strong className="public-invoice-total">${(invoice.amount_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></div>
      {invoice.invoice_terms && <p className="public-invoice-terms"><strong>Invoice terms</strong>{invoice.invoice_terms}</p>}
      {invoice.payment_description && <p className="public-invoice-terms"><strong>Note from {invoice.business_name}</strong>{invoice.payment_description}</p>}
      <button className="primary-button public-invoice-pay" type="button" disabled={paid || paying} onClick={payInvoice}>{paid ? 'Invoice paid' : paying ? 'Opening secure checkout…' : 'Pay securely with Stripe →'}</button>
      <p className="public-invoice-fallback">Secure invoice link:<br /><a href={invoice.payment_url}>{invoice.payment_url}</a></p>
      <div className="powered-by"><FoxMark size={16} /><span>Powered by <strong>PingFox</strong></span></div>
    </article>
  </main>;
}

function Brand() {
  return <a className="auth-brand auth-brand-link" href="/"><FoxMark size={30} /><span>PingFox</span></a>;
}
