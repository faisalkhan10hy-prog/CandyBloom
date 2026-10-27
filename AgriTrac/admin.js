(() => {
  'use strict';

  const form = document.querySelector('#adminAccessForm');
  const tokenInput = document.querySelector('#adminToken');
  const feedback = document.querySelector('#adminFeedback');
  const content = document.querySelector('#analyticsContent');
  const rows = document.querySelector('#agentRows');
  let token = '';

  async function loadAnalytics() {
    feedback.textContent = '';
    feedback.classList.remove('is-error');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const response = await fetch('/api/surveys/analytics', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Unable to load survey analytics.');

      document.querySelector('#averageRating').textContent = Number(result.averageRating).toFixed(2);
      document.querySelector('#totalResponses').textContent = result.totalResponses;
      document.querySelector('#positiveRatings').textContent = result.positiveRatings;
      document.querySelector('#negativeRatings').textContent = result.negativeRatings;
      document.querySelector('#neutralRatings').textContent = result.neutralRatings;
      rows.replaceChildren();
      if (result.agents.length === 0) {
        const row = rows.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 4;
        cell.textContent = 'No survey responses yet.';
      } else {
        for (const agent of result.agents) {
          const row = rows.insertRow();
          for (const value of [
            agent.agentId,
            agent.totalResponses,
            `${Number(agent.averageRating).toFixed(2)} / 5`,
            `${Number(agent.csatScore).toFixed(1)}%`
          ]) {
            row.insertCell().textContent = value;
          }
        }
      }
      content.hidden = false;
    } catch (error) {
      content.hidden = true;
      feedback.classList.add('is-error');
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    token = tokenInput.value;
    await loadAnalytics();
    tokenInput.value = '';
  });
  document.querySelector('#refreshAnalytics').addEventListener('click', loadAnalytics);
})();
