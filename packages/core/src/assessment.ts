// Self-assessment questionnaire -> "claimed" profile. Browser-safe.
// Claimed profiles are a starting point; measured profiles come from evidence (score.ts).
import type { Axis, AxisLevel, IntegrityGrade, Profile, ScopeClass } from "./types.ts";
import { compositeLevel, METHOD_VERSION } from "./model.ts";

export interface Question {
  id: string;
  axis: Axis | "S" | "I";
  prompt: string;
  options: { value: number; label: string }[];
}

export const QUESTIONS: Question[] = [
  {
    id: "O",
    axis: "O",
    prompt: "Who does the day-to-day work?",
    options: [
      { value: 0, label: "People do it. AI isn't part of execution." },
      { value: 1, label: "AI does single tasks when asked, and someone reviews every output." },
      { value: 2, label: "AI runs multi-step workflows in at least one area; people spot-check batches." },
      { value: 3, label: "AI runs at least one business area end to end, exceptions included. People only look at aggregate metrics." },
      { value: 4, label: "AI runs every area and hands work between them without a person routing it." },
      { value: 5, label: "AI also improves its own processes: it tests a change against real work, keeps it only if outcomes improve, and can show the evidence." },
    ],
  },
  {
    id: "D",
    axis: "D",
    prompt: "Who decides what to do?",
    options: [
      { value: 0, label: "People decide everything; AI gives no input." },
      { value: 1, label: "AI recommends; people decide." },
      { value: 2, label: "AI makes most routine tactical calls on its own (what to post, how to answer, which bug next)." },
      { value: 3, label: "AI also makes most operational calls and proposes strategy; people approve strategy." },
      { value: 4, label: "AI sets and executes strategy; people rarely veto (<10% of the time)." },
      { value: 5, label: "AI decides everything inside a written charter; people only change the charter or pull the emergency brake." },
    ],
  },
  {
    id: "F",
    axis: "F",
    prompt: "Who controls the money?",
    options: [
      { value: 0, label: "AI can't spend or earn." },
      { value: 1, label: "AI spends within pre-set budgets (API costs, ad caps)." },
      { value: 2, label: "AI also sets prices and runs the P&L for a product line." },
      { value: 3, label: "AI runs nearly all operating money flows: invoicing, collections, vendor payments, refunds." },
      { value: 4, label: "AI also allocates reserves and investments." },
      { value: 5, label: "AI also decides distributions to owners, within the charter." },
    ],
  },
  {
    id: "R",
    axis: "R",
    prompt: "How long does it run before a person has to step in to fix or rescue something? (Routine approvals and scheduled reviews don't count here; they are covered by the questions on work, decisions and money.)",
    options: [
      { value: 0, label: "Minutes to hours; anything unexpected stops it." },
      { value: 1, label: "About a working day; known failures are retried automatically." },
      { value: 2, label: "Several days; it reroutes around most failures itself." },
      { value: 3, label: "Weeks; it catches most problems before customers notice." },
      { value: 4, label: "Months; each incident leaves a fix that sticks." },
      { value: 5, label: "A year or more, including surviving a provider migration." },
    ],
  },
  {
    id: "N",
    axis: "N",
    prompt: "How does it deal with other autonomous companies? (Reported beside your level; it doesn't raise or lower it.)",
    options: [
      { value: 0, label: "It doesn't; only ordinary APIs and vendors." },
      { value: 1, label: "It buys services from other autonomous companies." },
      { value: 2, label: "It also sells a published service to them." },
      { value: 3, label: "It runs multi-step projects jointly with another autonomous company." },
      { value: 4, label: "It also rates, validates, or shares learnings with the network regularly." },
      { value: 5, label: "It has spawned another autonomous company that now runs at ZH2 or above." },
    ],
  },
  {
    id: "S",
    axis: "S",
    prompt: "What does it run?",
    options: [
      { value: 0, label: "One task." },
      { value: 1, label: "One business function (e.g. all of support)." },
      { value: 2, label: "One product, several functions." },
      { value: 3, label: "Several products." },
      { value: 4, label: "Several markets or regions." },
      { value: 5, label: "Several different business models." },
    ],
  },
  {
    id: "I1",
    axis: "I",
    prompt: "In the last 90 days, has an agent misled a customer, supplier, or partner?",
    options: [
      { value: 3, label: "No, and we check for it." },
      { value: 2, label: "Once, minor, and it was fixed." },
      { value: 0, label: "Yes, more than once or seriously." },
      { value: 1, label: "We don't know." },
    ],
  },
  {
    id: "I2",
    axis: "I",
    prompt: "Can an agent act outside its authority (spend, refund, commit) without being stopped?",
    options: [
      { value: 3, label: "No. Every action is checked against a written mandate before it runs." },
      { value: 2, label: "Mostly no; limits exist but aren't enforced everywhere." },
      { value: 0, label: "Yes, it has happened." },
      { value: 1, label: "We don't know." },
    ],
  },
  {
    id: "I3",
    axis: "I",
    prompt: "Do customers know they are dealing with AI, and are eligible refunds always honored?",
    options: [
      { value: 3, label: "Yes to both, always." },
      { value: 2, label: "Almost always." },
      { value: 1, label: "Sometimes." },
      { value: 0, label: "No." },
    ],
  },
];

export type Answers = Record<string, number>;

/** Integrity from self-report: the worst answer dominates; a self-report can't earn an A. */
function claimedIntegrity(answers: Answers): IntegrityGrade {
  const vals = ["I1", "I2", "I3"].map((k) => answers[k]);
  if (vals.some((v) => v === undefined)) return "U";
  const worst = Math.min(...vals);
  if (worst >= 3) return "B";
  if (worst === 2) return "C";
  return "D";
}

export function claimedProfile(answers: Answers, company = "self-assessed"): Profile {
  const lvl = (k: string) => Math.max(0, Math.min(5, answers[k] ?? 0)) as AxisLevel;
  const axes = { O: lvl("O"), D: lvl("D"), F: lvl("F"), R: lvl("R"), N: lvl("N") };
  const { level, limited_by } = compositeLevel(axes);
  return {
    spec: "0.2",
    method: METHOD_VERSION,
    company,
    level,
    axes,
    scope: lvl("S") as ScopeClass,
    integrity: claimedIntegrity(answers),
    assurance: "claimed",
    limited_by,
  };
}
