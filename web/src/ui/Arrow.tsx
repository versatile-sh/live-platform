/** A small arrow that follows the text colour, for links that lead somewhere. */
export function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`inline-block size-4 shrink-0 ${back ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}
