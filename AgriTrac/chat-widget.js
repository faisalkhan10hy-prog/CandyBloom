(() => {
  'use strict';

  const launcher = document.querySelector('#chatLauncher');
  const panel = document.querySelector('#chatPanel');
  const closeButton = document.querySelector('#chatClose');
  const screens = {
    welcome: document.querySelector('#chatWelcome'),
    conversation: document.querySelector('#chatConversation'),
    survey: document.querySelector('#chatSurvey'),
    thankyou: document.querySelector('#chatThankyou')
  };
  const messages = document.querySelector('#chatMessages');
  const compose = document.querySelector('#chatCompose');
  const messageInput = document.querySelector('#chatMessage');
  const surveyForm = document.querySelector('#surveyForm');
  const surveyFeedback = document.querySelector('#surveyFeedback');
  const submitButton = document.querySelector('#submitSurvey');
  const agentId = 'agritrac-demo-agent';
  let conversationId = '';
  let userId = '';

  function getUserId() {
    try {
      const savedId = localStorage.getItem('agritrac-chat-user-id');
      if (savedId) return savedId;
      const newId = crypto.randomUUID();
      localStorage.setItem('agritrac-chat-user-id', newId);
      return newId;
    } catch {
      return crypto.randomUUID();
    }
  }

  function setScreen(name) {
    for (const [screenName, element] of Object.entries(screens)) {
      element.hidden = screenName !== name;
    }
  }

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      const activeScreen = Object.values(screens).find((screen) => !screen.hidden);
      activeScreen?.querySelector('button, input, textarea')?.focus();
    } else {
      launcher.focus();
    }
  }

  function addMessage(text, sender) {
    const bubble = document.createElement('p');
    bubble.className = `chat-message chat-message-${sender}`;
    bubble.textContent = text;
    messages.append(bubble);
    messages.scrollTop = messages.scrollHeight;
  }

  function startConversation() {
    conversationId = crypto.randomUUID();
    userId = getUserId();
    messages.replaceChildren();
    addMessage('Hi! You’re chatting with the AgriTrac support preview. How can we help?', 'agent');
    setScreen('conversation');
    messageInput.focus();
  }

  function endConversation() {
    surveyForm.reset();
    surveyFeedback.textContent = '';
    surveyFeedback.classList.remove('is-error');
    setScreen('survey');
    document.querySelector('#rating1').focus();
  }

  launcher.addEventListener('click', () => setOpen(panel.hidden));
  closeButton.addEventListener('click', () => setOpen(false));
  document.querySelector('#startChat').addEventListener('click', startConversation);
  document.querySelector('#startAnotherChat').addEventListener('click', startConversation);
  document.querySelector('#endChat').addEventListener('click', endConversation);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  compose.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = messageInput.value.trim();
    if (!message) return;
    addMessage(message, 'visitor');
    messageInput.value = '';
  });

  surveyForm.querySelectorAll('input[name="rating"]').forEach((input) => {
    input.addEventListener('change', () => {
      const rating = Number(input.value);
      surveyForm.querySelectorAll('.survey-stars label').forEach((star, index) => {
        star.classList.toggle('is-active', index < rating);
      });
    });
  });

  surveyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    surveyFeedback.textContent = '';
    surveyFeedback.classList.remove('is-error');
    submitButton.disabled = true;
    const formData = new FormData(surveyForm);
    const survey = {
      conversationId,
      userId,
      agentId,
      rating: Number(formData.get('rating')),
      comment: String(formData.get('comment') ?? '').trim()
    };

    try {
      const response = await fetch('/api/surveys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(survey)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'We could not submit your feedback. Please try again.');
      setScreen('thankyou');
    } catch (error) {
      surveyFeedback.classList.add('is-error');
      surveyFeedback.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });
})();
