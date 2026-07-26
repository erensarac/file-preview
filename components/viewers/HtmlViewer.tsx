/**
 * Renders HTML produced by an adapter.
 *
 * The `html` here has already been through DOMPurify — on the client for
 * Markdown, on the server for Word — which is what makes the
 * `dangerouslySetInnerHTML` below safe. Any new adapter emitting `kind: "html"`
 * must sanitize before returning, not here.
 */
export default function HtmlViewer({ html }: { html: string }) {
  return (
    <div className="overflow-auto px-6 py-8 sm:px-10">
      <div
        className="rendered-doc mx-auto max-w-3xl"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
