import { Link } from 'react-router-dom';

import { routePaths } from '../routes/routePaths';

/** Shared "not designed yet" screen for login-flow sub-screens. Titles are the only difference. */
export function PlaceholderScreen({ title }: Readonly<{ title: string }>) {
  return (
    <div className="login-page">
      <div className="login-wrap">
        <div className="placeholder-card">
          <p className="placeholder-card__eyebrow">Placeholder</p>
          <h1>{title}</h1>
          <p className="placeholder-card__body">This page hasn&apos;t been designed yet.</p>
        </div>
        <Link to={routePaths.login} className="placeholder-back-link">
          ← Back to log in
        </Link>
      </div>
    </div>
  );
}
