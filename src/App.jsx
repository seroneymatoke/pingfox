import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { Landing } from './components/Landing';
import { Login, Onboarding, Register, VerifyEmail } from './components/AuthScreens';

function initialView() {
  if (window.location.hash === '#login') return 'login';
  if (window.location.hash === '#register') return 'register';
  if (window.location.hash === '#onboarding') return 'onboarding';
  return 'landing';
}

export default function App() {
  const [user, setUser] = useState(null);
  const [pendingVerification, setPendingVerification] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [verificationConfirmed] = useState(() => new URLSearchParams(window.location.search).get('verified') === 'success');
  const [view, setView] = useState(initialView);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then(response => response.ok ? response.json() : null)
      .then(setUser)
      .finally(() => setAuthLoading(false));

    const syncView = () => setView(initialView());
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  const goToLanding = () => { window.location.hash = ''; setView('landing'); };
  const goToLogin = () => { window.location.hash = 'login'; setView('login'); };
  const goToRegister = () => { window.location.hash = 'register'; setView('register'); };

  if (authLoading) return <main className="auth-loading" aria-label="Loading PingFox">Loading PingFox…</main>;
  if (user && !user.onboarding_complete) return <Onboarding user={user} onComplete={setUser} showConfirmation={verificationConfirmed} />;
  if (user) return <Dashboard onLogout={() => { setUser(null); goToLanding(); }} />;
  if (pendingVerification) return <VerifyEmail email={pendingVerification.email} onBackToLanding={() => { setPendingVerification(null); goToLanding(); }} />;
  if (view === 'login') return <Login onLogin={setUser} onRegister={goToRegister} onBackToLanding={goToLanding} />;
  if (view === 'register') return <Register onRegister={data => { setPendingVerification(data); setView('verify'); }} onBackToLanding={goToLanding} />;
  return <Landing onStart={goToLogin} />;
}
