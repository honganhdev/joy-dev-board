import { linkify } from '@/lib/linkify';

/**
 * A ticket description, rendered as text.
 *
 * The content is untrusted — it is whatever a customer or an agent typed — so
 * it never becomes HTML. `linkify` hands back segments, React renders each as a
 * text node, and only the ones it recognised as `http(s)` URLs get an anchor.
 * Line breaks are preserved because descriptions arrive as multi-paragraph
 * plain text and sometimes carry pasted JSON.
 */
export function DescriptionText({ text }: { text: string }) {
  return (
    <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
      {linkify(text).map((segment, index) =>
        segment.href ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700"
          >
            {segment.text}
          </a>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </p>
  );
}
