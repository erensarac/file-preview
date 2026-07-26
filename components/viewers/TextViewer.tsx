"use client";

import { useMemo } from "react";

/** Beyond this the line-number gutter costs more than it's worth rendering. */
const MAX_NUMBERED_LINES = 20_000;

export default function TextViewer({ text }: { text: string }) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const numbered = lines.length <= MAX_NUMBERED_LINES;

  if (!numbered) {
    return (
      <pre className="overflow-auto px-6 py-6 font-mono text-sm leading-6">
        {text}
      </pre>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-max border-collapse font-mono text-sm leading-6">
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <td className="sticky left-0 select-none border-r border-line bg-canvas px-3 text-right align-top tabular-nums text-muted">
                {index + 1}
              </td>
              <td className="whitespace-pre px-4">{line || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
