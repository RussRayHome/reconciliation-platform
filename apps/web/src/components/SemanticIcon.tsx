import type { SVGProps } from 'react';

/** Union of all recognized icon slot names used across the application. */
export type SemanticIconName =
  | 'upload'
  | 'search'
  | 'rule'
  | 'rules'
  | 'exceptions'
  | 'reports'
  | 'help'
  | 'overview'
  | 'architecture'
  | 'setup'
  | 'reference'
  | 'operations'
  | 'records'
  | 'match'
  | 'review'
  | 'missing'
  | 'duplicate'
  | 'calendar'
  | 'clock'
  | 'quality'
  | 'exposure'
  | 'profile'
  | 'security'
  | 'billing'
  | 'notification'
  | 'preferences'
  | 'remove';

type SemanticIconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  name: SemanticIconName;
};

const renderIconPath = (name: SemanticIconName) => {
  switch (name) {
    case 'upload':
      return (
        <>
          <path d="M12 4v10" />
          <path d="m7 9 5-5 5 5" />
          <rect x="4" y="15" width="16" height="5" rx="1.5" />
        </>
      );
    case 'search':
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <line x1="15.3" y1="15.3" x2="20" y2="20" />
        </>
      );
    case 'rule':
      return (
        <>
          <rect x="3" y="9" width="18" height="6" rx="1" />
          <line x1="7" y1="9" x2="7" y2="12" />
          <line x1="11" y1="9" x2="11" y2="13" />
          <line x1="15" y1="9" x2="15" y2="12" />
          <line x1="19" y1="9" x2="19" y2="13" />
        </>
      );
    case 'rules':
      return (
        <>
          <line x1="4" y1="6" x2="20" y2="6" />
          <circle cx="9" cy="6" r="1.75" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <circle cx="14" cy="12" r="1.75" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="7" cy="18" r="1.75" />
        </>
      );
    case 'exceptions':
      return (
        <>
          <path d="m12 4 8.4 15H3.6L12 4Z" />
          <line x1="12" y1="10" x2="12" y2="14" />
          <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
        </>
      );
    case 'reports':
      return (
        <>
          <line x1="4" y1="20" x2="20" y2="20" />
          <rect x="6" y="11" width="3" height="9" rx="1" />
          <rect x="10.5" y="8" width="3" height="12" rx="1" />
          <rect x="15" y="13" width="3" height="7" rx="1" />
        </>
      );
    case 'help':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M9.7 9.5a2.4 2.4 0 1 1 4.5 1.1c-.6 1.2-1.9 1.4-2.2 2.8" />
          <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
        </>
      );
    case 'overview':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <line x1="8" y1="9" x2="16" y2="9" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </>
      );
    case 'architecture':
      return (
        <>
          <rect x="3.5" y="4" width="7" height="6" rx="1" />
          <rect x="13.5" y="4" width="7" height="6" rx="1" />
          <rect x="8.5" y="14" width="7" height="6" rx="1" />
          <line x1="10.5" y1="7" x2="13.5" y2="7" />
          <line x1="12" y1="10" x2="12" y2="14" />
        </>
      );
    case 'setup':
      return (
        <>
          <circle cx="7" cy="17" r="2.3" />
          <path d="M9 15 18 6l2 2-9 9" />
          <path d="m15.5 4.5 4 4" />
        </>
      );
    case 'reference':
      return (
        <>
          <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1Z" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="9" y1="11" x2="15" y2="11" />
        </>
      );
    case 'operations':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="5" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="19" />
          <line x1="19" y1="12" x2="21" y2="12" />
          <line x1="3" y1="12" x2="5" y2="12" />
          <line x1="17" y1="7" x2="18.4" y2="5.6" />
          <line x1="5.6" y1="18.4" x2="7" y2="17" />
          <line x1="17" y1="17" x2="18.4" y2="18.4" />
          <line x1="5.6" y1="5.6" x2="7" y2="7" />
        </>
      );
    case 'records':
      return (
        <>
          <rect x="4" y="5" width="16" height="4" rx="1.2" />
          <rect x="4" y="10" width="16" height="4" rx="1.2" />
          <rect x="4" y="15" width="16" height="4" rx="1.2" />
        </>
      );
    case 'match':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.5 12.3 2.2 2.2 4.8-4.8" />
        </>
      );
    case 'review':
      return (
        <>
          <circle cx="11" cy="11" r="6" />
          <line x1="15.5" y1="15.5" x2="20" y2="20" />
          <line x1="11" y1="8.3" x2="11" y2="13.7" />
          <line x1="8.3" y1="11" x2="13.7" y2="11" />
        </>
      );
    case 'missing':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </>
      );
    case 'duplicate':
      return (
        <>
          <rect x="8" y="8" width="10" height="10" rx="1.5" />
          <rect x="4" y="4" width="10" height="10" rx="1.5" />
        </>
      );
    case 'calendar':
      return (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <line x1="4" y1="9" x2="20" y2="9" />
          <line x1="8" y1="3.5" x2="8" y2="7" />
          <line x1="16" y1="3.5" x2="16" y2="7" />
          <line x1="8" y1="13" x2="11" y2="13" />
          <line x1="13" y1="13" x2="16" y2="13" />
        </>
      );
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <line x1="12" y1="8" x2="12" y2="12.5" />
          <line x1="12" y1="12.5" x2="15" y2="14.5" />
        </>
      );
    case 'quality':
      return (
        <>
          <path d="m12 3 7 3.2V11c0 4.3-2.8 7.3-7 9.8-4.2-2.5-7-5.5-7-9.8V6.2L12 3Z" />
          <line x1="12" y1="8" x2="12" y2="12.5" />
          <circle cx="12" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
        </>
      );
    case 'exposure':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <line x1="12" y1="7" x2="12" y2="17" />
          <path d="M14.8 8.8c0-1.2-1.1-2.1-2.8-2.1-1.5 0-2.7.9-2.7 2.1 0 3.2 5.5 1.6 5.5 4.5 0 1.3-1.2 2.2-2.8 2.2s-2.7-.9-2.8-2.2" />
        </>
      );
    case 'profile':
      return (
        <>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
        </>
      );
    case 'security':
      return (
        <>
          <path d="M12 3.5 19 6.5v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10v-5Z" />
          <path d="m9 12 2 2 4-4" />
        </>
      );
    case 'billing':
      return (
        <>
          <rect x="3.5" y="6" width="17" height="12" rx="2" />
          <line x1="3.5" y1="10" x2="20.5" y2="10" />
          <line x1="7" y1="14.5" x2="11" y2="14.5" />
        </>
      );
    case 'notification':
      return (
        <>
          <path d="M12 4a4.5 4.5 0 0 0-4.5 4.5v3.5L6 15h12l-1.5-3V8.5A4.5 4.5 0 0 0 12 4Z" />
          <path d="M10 18a2 2 0 0 0 4 0" />
        </>
      );
    case 'preferences':
      return (
        <>
          <rect x="4" y="9" width="16" height="6" rx="3" />
          <circle cx="15" cy="12" r="2.2" fill="currentColor" stroke="none" />
        </>
      );
    case 'remove':
      return (
        <>
          <rect x="6" y="8" width="12" height="12" rx="1.5" />
          <path d="M4 8h16" />
          <path d="M9 8V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V8" />
          <line x1="10" y1="11.5" x2="10" y2="16.5" />
          <line x1="14" y1="11.5" x2="14" y2="16.5" />
        </>
      );
    default:
      return <circle cx="12" cy="12" r="8" />;
  }
};

/** Renders the SVG icon that corresponds to `name`, passing through any additional SVG props. */
export function SemanticIcon({ name, className, ...rest }: Readonly<SemanticIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {renderIconPath(name)}
    </svg>
  );
}
