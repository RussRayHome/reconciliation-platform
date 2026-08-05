import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { dashboardApiFetch, githubLoginUrl } from './lib/api';
import { DeveloperDashboard } from './components/DeveloperDashboard';

type Session = { login: string; name: string | null; avatarUrl: string | null };
type AuthState = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; session: Session };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    dashboardApiFetch('/api/auth/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((session: Session | null) => {
        setAuth(session ? { status: 'signed-in', session } : { status: 'signed-out' });
      })
      .catch(() => setAuth({ status: 'signed-out' }));
  }, []);

  if (auth.status === 'loading') {
    return null;
  }

  if (auth.status === 'signed-out') {
    return (
      <main className="developer-dashboard-login">
        <h1>Developer Dashboard</h1>
        <p>Sign in with an authorized GitHub account to view the latest quality-gate results.</p>
        <a className="accent-button" href={githubLoginUrl()}>
          Sign in with GitHub
        </a>
      </main>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DeveloperDashboard session={auth.session} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
