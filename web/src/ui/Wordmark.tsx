/** The logotype: `versatile.sh` as the company writes it, and `live` answering from inside a bubble. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline ${className}`} translate="no">
      <span className="font-serif text-[1.75em] leading-none italic">versatile</span>
      <span className="ml-[0.15em] font-mono text-[0.8em] text-accent">.sh</span>
      <span className="bubble-word ml-[0.6em] inline-block translate-y-[-0.16em] bg-bubble px-[0.52em] py-[0.3em] font-mono text-[0.72em] leading-none font-medium text-on-bubble">live</span>
    </span>
  );
}
