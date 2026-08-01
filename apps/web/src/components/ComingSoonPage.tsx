import { SectionCard } from '@recon/ui';

/** Shared placeholder for menu destinations that don't have a built screen yet. */
export function ComingSoonPage({
  title,
  description,
}: Readonly<{
  title: string;
  description: string;
}>) {
  return (
    <SectionCard title={title} description={description}>
      <p className="coming-soon-note">This screen is coming soon.</p>
    </SectionCard>
  );
}
