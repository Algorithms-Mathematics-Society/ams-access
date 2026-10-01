/** Additional UI fixtures, installed only in the disposable CDP browser. */
export function installDashboardFixtures(config) {
  if (location.origin !== config.origin) return;
  const fixtureFetch = window.fetch.bind(window);
  const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  if (config.mode === 'long') localStorage.setItem('ams_display_name', 'Candidate-' + 'LongName'.repeat(24));
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const p = url.pathname;
    if (p.endsWith('/resume-request')) {
      if (!config.mode.startsWith('resume-')) return response(null);
      const status = config.mode.slice(7).toUpperCase();
      return response({ uid: 'preview-request', status, created_at: new Date().toISOString(), review_note: status === 'REJECTED' ? 'Organizer rejected this resume request.' : null });
    }
    const result = await fixtureFetch(input, init);
    if (p.endsWith('/participant/contests') && ['states', 'long'].includes(config.mode)) {
      const [contest, practice] = await result.json();
      if (config.mode === 'long') return response([{ ...contest, title: 'Contest-' + 'LongTitle'.repeat(20), organization_name: 'Organization-' + 'LongName'.repeat(20) }, practice]);
      const date = minutes => new Date(Date.now() + minutes * 60000).toISOString();
      return response([contest, practice,
        { ...contest, uid:'scheduled', title:'Upcoming contest', status:'SCHEDULED', starts_at:date(120),ends_at:date(180) },
        { ...contest, uid:'verification', title:'Verification window', status:'SCHEDULED', starts_at:date(10),ends_at:date(100) },
        { ...contest, uid:'ended', title:'Ended contest', status:'ENDED', starts_at:date(-120),ends_at:date(-30) },
        { ...contest, uid:'unavailable', title:'Missing schedule', starts_at:null,ends_at:null },
      ]);
    }
    return result;
  };
}
