/** Browser-only fixtures installed through CDP in a disposable Chrome profile.
 * Never imported by the app. The capture runner blocks all non-local HTTP requests.
 */
export function installFixtures(config) {
  if (location.origin !== config.origin) return;
  localStorage.clear();
  localStorage.setItem('ams_theme', config.theme || 'dark');
  const now = new Date().toISOString();
  const ends = new Date(Date.now() + 5400000).toISOString();
  const problems = [
    { label: 'A', title: 'Binary Search', score: 100, time_limit_ms: 2000, memory_limit_mb: 256 },
    { label: 'B', title: 'Balanced Brackets', score: 100, time_limit_ms: 2000, memory_limit_mb: 256 },
  ];
  const contest = {
    uid: 'p0-contest', title: 'P0 Preview — Coding Round', description: 'Isolated baseline fixture.',
    status: 'ACTIVE', starts_at: new Date(Date.now() - 600000).toISOString(), ends_at: ends,
    is_practice: false, frozen: false, organization_name: 'AMS', verification_window_minutes: 30,
    problems, server_time: now, remaining_ms: 5400000, phase: 'running',
  };
  const session = { uid: 'p0-session', contest_uid: contest.uid, status: 'active', started_at: now,
    ended_at: null, violation_count: 0, resume_count: 0, server_time: now,
    remaining_ms: 5400000, ends_at: ends, phase: 'running' };
  localStorage.setItem('ams_participant_token', 'p0-local-fixture-not-a-real-token');
  localStorage.setItem('ams_display_name', 'Preview Candidate');
  if (!['empty', 'loading', 'error'].includes(config.mode)) {
    localStorage.setItem('ams_active_session', JSON.stringify({
      id: session.uid, contest_id: contest.uid, contest_title: contest.title,
    }));
  }
  const submissions = [{ uid: 'p0-attempt-a', problem_label: 'A', language: 'cpp', status: 'completed',
    created_at: now, verdict: 'AC', score: 100, passed_count: 1, total_count: 1,
    max_runtime_ms: 12, max_memory_kb: 1024, compile_output: '',
    testcases: [{ kind: 'io', testcase_no: 1, label: 'Sample 1', verdict: 'AC', runtime_ms: 12,
      memory_kb: 1024, checker_message: '' }] }];
  const originalFetch = window.fetch.bind(window);
  window.__p0Requests = [];
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const p = url.pathname;
    if (url.origin === location.origin && !p.includes('/participant/') && !p.startsWith('/api/')) {
      return originalFetch(input, init);
    }
    window.__p0Requests.push({ path: p, method: init.method || (input instanceof Request ? input.method : 'GET') });
    const response = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    if (p.endsWith('/participant/login')) {
      if (config.mode === 'login-loading') return new Promise(() => {});
      return response({ detail: 'Incorrect handle or password. Please check your details.' }, 401);
    }
    if (p.endsWith('/participant/contests')) {
      if (config.mode === 'loading') return new Promise(() => {});
      if (config.mode === 'error') return response({ detail: 'Preview: connection unavailable.' }, 503);
      return response(config.mode === 'empty' ? [] : [contest,
        { ...contest, uid: 'p0-practice', title: 'Practice environment', is_practice: true, ends_at: null }]);
    }
    if (p.includes('/problems/')) {
      const item = problems.find(q => p.endsWith('/' + q.label)) || problems[0];
      return response({ problem: { ...item, schema_version: 2, language: 'cpp', standard: 'c++23',
        limits: { cpu_time_ms: 1000, wall_time_ms: 2000, memory_mb: 256 },
        statement: { markdown: item.label === 'A'
          ? 'Given a sorted array of integers and a target value, return its index. If it is absent, return -1.\n\n## Examples\nInput: [1, 3, 5, 7], target = 5\n\nOutput: 2\n\n## Constraints\n- 1 <= n <= 100000\n- The array is sorted.'
          : 'Determine whether a sequence of brackets is balanced.\n\n## Examples\nInput: ()[]{}\n\nOutput: true\n\n## Constraints\n- 1 <= n <= 100000',
          sha256: 'p0-fixture', size_bytes: 250 },
        starter: { source: '#include <vector>\n\nint solve(const std::vector<int>& values) {\n    // Write your solution here\n    return -1;\n}\n',
          filename: 'solution.cpp', sha256: 'p0-fixture', size_bytes: 120 },
        samples: [{ label: 'Example 1', input: '4 5\n1 3 5 7', output: '2' }], assets: [],
        families: { io: { graded: true, weight: 100, count: 1 },
          behavior: { graded: false, weight: 0, count: 0, present: false },
          symbolic: { graded: false, gate: true, rules: [], count: 0 } },
      } });
    }
    if (p.includes('/participant/contests/')) {
      if (config.mode === 'results-error') return response({ detail: 'Preview unavailable.' }, 503);
      if (config.mode === 'results-loading') return new Promise(() => {});
      return response(contest);
    }
    if (p.endsWith('/drafts')) return response([]);
    if (p.endsWith('/submissions')) return response(config.mode === 'results-empty' ? [] : submissions);
    if (p.includes('overrides')) return response([]);
    if (p.includes('/participant/sessions/')) return response(session);
    // Unknown APIs fail clearly rather than fabricating successful native checks.
    return response({ detail: 'Unimplemented P0 fixture', path: p }, 503);
  };
}
