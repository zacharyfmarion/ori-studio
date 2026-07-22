import type { LucideProps } from 'lucide-react';

/** Lucide has no protractor; this matches its 24px grid and stroke conventions. */
export function ProtractorIcon({ size = 20, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 18a8 8 0 0 1 16 0" />
      <path d="M3 18h18" />
      <path d="M12 18v-2.5" />
      <path d="m17.7 12.3-1.8 1.8" />
      <path d="m6.3 12.3 1.8 1.8" />
    </svg>
  );
}
