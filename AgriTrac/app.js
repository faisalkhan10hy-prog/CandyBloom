(() => {
  'use strict';

  const menuToggle = document.querySelector('#menuToggle');
  const mainNav = document.querySelector('#mainNav');
  const searchForm = document.querySelector('#helpSearch');
  const searchInput = document.querySelector('#helpQuery');
  const searchFeedback = document.querySelector('#searchFeedback');
  const supportCards = [...document.querySelectorAll('.support-card')];
  const faqItems = [...document.querySelectorAll('.faq-item')];
  const emptySearch = document.querySelector('#emptySearch');
  const requestForm = document.querySelector('#requestForm');
  const requestTopic = document.querySelector('#requestTopic');
  const formFeedback = document.querySelector('#formFeedback');
  const trackForm = document.querySelector('#trackForm');
  const trackFeedback = document.querySelector('#trackFeedback');
  const backendMode = document.querySelector('#backendMode');
  const toast = document.querySelector('#toast');
  let toastTimer;

  async function postJson(path, value) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'The support server could not complete that request.');
    return payload;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3500);
  }

  async function checkBackend() {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      const status = await response.json();
      if (!response.ok || status.mode === 'unconfigured') {
        backendMode.dataset.mode = 'unconfigured';
        backendMode.lastChild.textContent = ` Ticket backend needs configuration: ${status.configurationError || 'check the server settings.'}`;
        return;
      }
      if (status.mode === 'freshservice') {
        backendMode.dataset.mode = 'freshservice';
        backendMode.lastChild.textContent = ' Connected to Freshservice. New requests go to its configured support workflow.';
      } else {
        backendMode.dataset.mode = 'demo';
        backendMode.lastChild.textContent = ' Demo mode: requests save on this server, but are not sent to a support agent yet.';
      }
    } catch {
      backendMode.dataset.mode = 'offline';
      backendMode.lastChild.textContent = ' Start the AgriTrac server to submit or track support requests.';
    }
  }

  function closeMenu() {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation menu');
    mainNav.classList.remove('is-open');
  }

  menuToggle.addEventListener('click', () => {
    const willOpen = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(willOpen));
    menuToggle.setAttribute('aria-label', willOpen ? 'Close navigation menu' : 'Open navigation menu');
    mainNav.classList.toggle('is-open', willOpen);
  });
  mainNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  function bindPopularSearches() {
    searchFeedback.querySelectorAll('[data-search]').forEach((button) => {
      button.addEventListener('click', () => {
        searchInput.value = button.dataset.search;
        applySearch(searchInput.value);
        document.querySelector('#support').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, { once: true });
    });
  }

  function applySearch(rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    let resultCount = 0;
    supportCards.forEach((card) => {
      const searchable = `${card.dataset.topic} ${card.dataset.terms} ${card.innerText}`.toLowerCase();
      card.hidden = Boolean(query) && !searchable.includes(query);
      if (!card.hidden) resultCount += 1;
    });
    faqItems.forEach((item) => {
      item.hidden = Boolean(query) && !item.innerText.toLowerCase().includes(query);
      if (!item.hidden) resultCount += 1;
    });
    emptySearch.hidden = !query || resultCount > 0;
    if (!query) {
      searchFeedback.innerHTML = 'Popular: <button type="button" data-search="oil filter">Oil filter</button><button type="button" data-search="manual">Operator manual</button><button type="button" data-search="warranty">Warranty</button>';
      bindPopularSearches();
    } else {
      searchFeedback.textContent = resultCount
        ? `${resultCount} helpful result${resultCount === 1 ? '' : 's'} for “${rawQuery.trim()}”.`
        : `No results for “${rawQuery.trim()}”.`;
    }
  }

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    applySearch(searchInput.value);
    document.querySelector('#support').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  searchInput.addEventListener('input', () => applySearch(searchInput.value));
  bindPopularSearches();

  document.querySelector('#clearSearch').addEventListener('click', () => {
    searchInput.value = '';
    applySearch('');
    searchInput.focus();
  });

  supportCards.forEach((card) => {
    card.addEventListener('click', () => {
      requestTopic.value = card.dataset.topic;
      document.querySelector('#request').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => document.querySelector('#requestName').focus({ preventScroll: true }), 400);
    });
  });

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    formFeedback.classList.remove('is-error');
    formFeedback.textContent = '';
    const submitButton = requestForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const formData = new FormData(requestForm);
    const ticket = {
      name: String(formData.get('name')).trim(),
      email: String(formData.get('email')).trim(),
      topic: String(formData.get('topic')),
      model: String(formData.get('model')).trim(),
      message: String(formData.get('message')).trim()
    };

    try {
      const result = await postJson('/api/tickets', ticket);
      formFeedback.textContent = result.mode === 'freshservice'
        ? `Ticket ${result.ticketNumber} created in Freshservice. Status: ${result.status}. Keep the request number and email for tracking.`
        : `Request ${result.ticketNumber} saved by the server in demo mode. It has not been sent to an agent. Configure Freshservice to route it to your support team.`;
      requestForm.reset();
      showToast(`Request ${result.ticketNumber} created.`);
    } catch (error) {
      formFeedback.classList.add('is-error');
      formFeedback.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  trackForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    trackFeedback.classList.remove('is-error');
    trackFeedback.textContent = '';
    const submitButton = trackForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const formData = new FormData(trackForm);

    try {
      const result = await postJson('/api/tickets/lookup', {
        ticketNumber: String(formData.get('ticketNumber')).trim(),
        email: String(formData.get('email')).trim()
      });
      const topic = result.topic || result.subject || 'Support request';
      trackFeedback.textContent = `${result.ticketNumber} · ${topic} · Status: ${result.status}.`;
    } catch (error) {
      trackFeedback.classList.add('is-error');
      trackFeedback.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  void checkBackend();
})();
