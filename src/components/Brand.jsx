export function FoxMark({ size = 30 }) {
  return <svg className="fox-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M6 12 4 5l7 4 5-3 5 3 7-4-2 7c0 8-4.5 13-10 13S6 20 6 12Z" fill="#FF6B3D" />
    <circle cx="12.5" cy="14" r="1.4" fill="#14161C" />
    <circle cx="19.5" cy="14" r="1.4" fill="#14161C" />
    <path d="M13 18.5c1 1 4 1 5 0" stroke="#14161C" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

function ProviderIcon({ provider }) {
  if (provider === 'Google') return <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.72-.06-1.42-.18-2.09H12v3.96h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.89-1.74 2.99-4.31 2.99-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.22-2.51c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.06v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.9A6 6 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.06A10 10 0 0 0 2 12c0 1.61.39 3.13 1.06 4.49l3.33-2.59Z"/><path fill="#EA4335" d="M12 5.97c1.47 0 2.79.51 3.83 1.51l2.87-2.87C16.96 2.99 14.7 2 12 2a10 10 0 0 0-8.94 5.51l3.33 2.59C7.18 7.73 9.39 5.97 12 5.97Z"/></svg>;
  if (provider === 'Facebook') return <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.5h3.05V9.4c0-3.04 1.79-4.72 4.56-4.72 1.32 0 2.7.24 2.7.24v2.99h-1.52c-1.5 0-1.97.94-1.97 1.9v2.25h3.35l-.54 3.5H13.9V24C19.62 23.1 24 18.1 24 12.07Z"/></svg>;
  return <svg className="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F35325" d="M1 1h10.5v10.5H1z"/><path fill="#81BC06" d="M12.5 1H23v10.5H12.5z"/><path fill="#05A6F0" d="M1 12.5h10.5V23H1z"/><path fill="#FFBA08" d="M12.5 12.5H23V23h-10.5z"/></svg>;
}

export function OAuthButton({ provider, onClick }) {
  return <button type="button" className="oauth-button" onClick={onClick}><ProviderIcon provider={provider} /><span>{provider}</span></button>;
}
