/** A line that types itself in word by word on the first load of the site (CSS `enter-typed`), starting at `from` seconds. */
export function Typed({ text, from, step = 0.08, className = "" }: { text: string; from: number; step?: number; className?: string }) {
  return (
    <span className={className}>
      {text.split(" ").map((word, index) => (
        <span key={`${word}-${index}`} className="enter-typed" style={{ "--d": `${from + index * step}s` } as React.CSSProperties}>
          {word}
          {index < text.split(" ").length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}
