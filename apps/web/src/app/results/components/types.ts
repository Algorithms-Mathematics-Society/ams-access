export type ProblemState = {
  question_id: string;
  attempts: number;
  best_score: number;
  verdict: string;
  last_submission_at: string | null;
};

export type LeaderboardEntry = {
  rank: number;
  session_id: string;
  candidate_name: string;
  candidate_email: string;
  total_score: number;
  solved_count: number;
  penalty_seconds: number;
  problems: ProblemState[];
};

export type Question = { id: string; title: string; points: number; order_index: number };

export type ResultsData = {
  contest_id: string;
  status: string;
  scoring_type: string;
  results_visible_at: string;
  questions: Question[];
  entries: LeaderboardEntry[];
  my_session_id: string;
};

export type MySubmission = {
  id: string;
  problem_id: string;
  problem_title: string;
  attempt_no: number;
  language: string;
  status: string;
  final_verdict: string | null;
  score: number;
  runtime_ms: number | null;
  memory_kb: number | null;
  created_at: string;
};
