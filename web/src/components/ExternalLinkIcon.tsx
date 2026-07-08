/** "Open in new tab" glyph: a box with an arrow escaping the top-right corner. */
export function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="0.8em"
      height="0.8em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ marginLeft: '0.3em', verticalAlign: '-0.05em' }}
    >
      <path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5" />
      <path d="M14.5 3H21v6.5" />
      <path d="M21 3 10.5 13.5" />
    </svg>
  );
}
