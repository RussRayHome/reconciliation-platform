import { useNavigate } from 'react-router-dom';

/** Shared placeholder for menu destinations that don't have a built screen yet. */
export function ComingSoonPage({
  title,
  description,
}: Readonly<{
  title: string;
  description: string;
}>) {
  const navigate = useNavigate();

  return (
    <div className="coming-soon-page">
      <div className="placeholder-card">
        <p className="placeholder-card__eyebrow">Placeholder</p>
        <h1>{title}</h1>
        <p className="placeholder-card__body">{description}</p>
      </div>
      <button type="button" className="placeholder-back-link" onClick={() => navigate(-1)}>
        ← Back
      </button>
    </div>
  );
}
