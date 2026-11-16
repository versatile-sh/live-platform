/** The logotype: `live` speaks from inside a bubble, then `versatile.sh` as the company writes it. On the accent it sits on its own ink plate, so the lime of `.sh` survives. */
export function Wordmark({ className = "", onAccent = false }: { className?: string; onAccent?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-[0.55em] ${onAccent ? "rounded-xl bg-ink px-[0.7em] py-[0.5em] text-paper" : ""} ${className}`} translate="no">
      <span className="bubble-word inline-block bg-bubble px-[0.5em] py-[0.3em] font-mono text-[0.8em] leading-none font-medium text-on-bubble">live</span>
      <span className="font-mono leading-none font-bold tracking-[-0.02em]">
        versatile<span className={onAccent ? "text-bubble" : "text-accent"}>.sh</span>
      </span>
    </span>
  );
}
