/**
 * What this problem is marked on, stated before the candidate writes.
 *
 * The judge runs three independent families, and the scoreboard treats them
 * very differently: behaviour is weighted more heavily than I/O, and
 * **symbolic is a gate** — one violation zeroes the problem's whole partial
 * credit, however well the code runs.
 *
 * All of it has been on the wire since contract v2 and none of it reached the
 * screen. A candidate could lose a problem outright to a rule nobody showed
 * them, which is not a marking scheme, it is a trap.
 *
 * Rendered in the statement, always visible — not behind a tab. A rule you
 * have to go looking for is a rule you can miss.
 */

import { ruleText } from "../family-summary";
import type { Question } from "./questions";

export function MarkingScheme({ question }: { question: Question }) {
  const families = question.families;
  if (!families) return null;

  const symbolic = families.symbolic;
  const rules = symbolic?.rules ?? [];

  // A projection reconstructed from the pre-v2 columns knows the statement
  // but not the marking scheme. Saying "no rules" there would be a claim we
  // cannot support — and the one direction in which being wrong is unfair.
  if (question.backfilled) {
    return (
      <section className="pb-marking" aria-label="How this is marked">
        <h2 className="pb-marking-title">How this is marked</h2>
        <p className="pb-marking-note">
          The full marking breakdown isn&rsquo;t available for this problem. Read the statement
          carefully for any restrictions on what you may use.
        </p>
      </section>
    );
  }

  const graded = [
    { label: "Input/output tests", family: families.io },
    { label: "Behaviour tests", family: families.behavior },
  ].filter((entry) => entry.family && entry.family.count > 0);

  return (
    <section className="pb-marking" aria-label="How this is marked">
      <h2 className="pb-marking-title">How this is marked</h2>

      {graded.length > 0 && (
        <ul className="pb-marking-list">
          {graded.map(({ label, family }) => (
            <li key={label}>
              {family.count} {label.toLowerCase()}
              {family.weight > 1 && <span className="pb-marking-weight"> ×{family.weight}</span>}
            </li>
          ))}
        </ul>
      )}

      {rules.length > 0 && (
        <div className="pb-marking-gate">
          <h3 className="pb-marking-gate-title">Restrictions</h3>
          <ul className="pb-marking-gate-list">
            {rules.map((rule) => (
              <li key={`${rule.kind}:${rule.pattern}`}>
                <code>{rule.pattern}</code> — {ruleText(rule)}
              </li>
            ))}
          </ul>
          {/* The consequence, in the same breath as the rule. Knowing a
              restriction exists is not the same as knowing it is absolute. */}
          <p className="pb-marking-gate-note">
            These aren&rsquo;t scored on their own. Breaking one scores{" "}
            <strong>zero for this problem</strong>, however well your code runs.
          </p>
        </div>
      )}
    </section>
  );
}
