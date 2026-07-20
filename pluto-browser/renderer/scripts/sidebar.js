/* ═══════════════════════════════════════════════════════════════
   PLUTO — AI Sidebar Controller
   Chat, model switching, attachments, agent execution
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  /* ── DOM ──────────────────────────────────────────────────── */
  const chatMessages    = $('#chat-messages');
  const chatInput       = $('#chat-input');
  const btnSend         = $('#btn-send');
  const modelSelect     = $('#model-select');
  const btnScanModels   = $('#btn-scan-models');
  const btnNewChat      = $('#btn-new-chat');
  const chatWelcome     = $('#chat-welcome');
  const attachmentsBar  = $('#attachments-bar');
  const btnAttachSource = $('#btn-attach-source');
  const btnAttachImage  = $('#btn-attach-image');
  const btnPasteClip    = $('#btn-paste-clipboard');
  const statusDot       = $('#backend-status-dot');
  const statusText      = $('#backend-status-text');
  const webSlot         = $('#web-content-slot');
  const btnSideSettings = $('#btn-sidebar-settings');
  const btnAgentMode    = $('#btn-agent-mode');
  const skillsPopup     = $('#skills-popup');
  const skillsList      = $('#skills-list');

  /* ── State ───────────────────────────────────────────────── */
  let backendPort  = 18420;
  let messages     = [];
  let attachments  = [];  // { type: 'image'|'url'|'text', data, name }
  let isStreaming   = false;
  let currentModel  = '';
  let abortCtrl     = null;
  let isAgentMode   = true;  // Default to true (Agent Browser)
  let availableSkills = [];
  let selectedSkillIndex = -1;

  /* ── Init ────────────────────────────────────────────────── */
  async function init() {
    try {
      backendPort = await plutoAPI.getBackendPort();
    } catch { /* use default */ }
    
    // Style active Agent Mode on load
    if (isAgentMode && btnAgentMode) {
      btnAgentMode.classList.add('agent-active');
    }

    // Auto-scroll observer: scroll to bottom on any content mutation
    if (chatMessages) {
      const autoScrollObserver = new MutationObserver(() => {
        requestAnimationFrame(() => scrollToBottom());
      });
      autoScrollObserver.observe(chatMessages, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    
    scanModels();
    pollBackendHealth();
    loadSkills();

    /* ── CodeChef Auto-detection & Suggestion Card ── */
    const codechefSuggest = document.getElementById('codechef-suggestion');
    const btnRunCodechef = document.getElementById('btn-run-codechef-auto');

    if (codechefSuggest && btnRunCodechef) {
      try {
        const contextTitleEl = document.getElementById('context-page-title');
        plutoAPI.onTabUpdated((info) => {
          if (info.url && info.url.includes('codechef.com')) {
            codechefSuggest.classList.remove('hidden');
          } else {
            codechefSuggest.classList.add('hidden');
          }
          if (contextTitleEl && info.active) {
            const title = info.title || (info.url ? info.url.replace(/^https?:\/\//, '') : 'New Tab');
            contextTitleEl.textContent = `Attached: ${title}`;
          }
        });

        // Click handler to pre-fill prompt and submit
        btnRunCodechef.addEventListener('click', () => {
          chatInput.value = "/codechef resume the course and complete all coding and MCQ problems. Verify runs are successful before submitting, and only click Next after Correct Answer is shown on screen.";
          sendMessage();
          codechefSuggest.classList.add('hidden');
        });

        // Initial check on load
        setTimeout(async () => {
          try {
            const activeUrl = await plutoAPI.getActiveUrl();
            if (activeUrl && activeUrl.includes('codechef.com')) {
              codechefSuggest.classList.remove('hidden');
            }
          } catch (e) {}
        }, 1000);
      } catch (e) {
        console.error('[codechef suggest registration error]', e);
      }
    }
  }

  async function loadSkills() {
    try {
      availableSkills = await plutoAPI.getSkills();
    } catch (e) {
      console.error('[sidebar skills error]', e);
    }
  }

  let wasConnected = false;

  /* ── Backend Health ──────────────────────────────────────── */
  async function pollBackendHealth() {
    try {
      const resp = await fetch(`http://localhost:${backendPort}/api/health`);
      if (resp.ok) {
        statusDot.classList.add('connected');
        statusText.textContent = 'AI Ready';
        if (!wasConnected) {
          wasConnected = true;
          scanModels();
        }
        setTimeout(pollBackendHealth, 5000);
        return;
      }
    } catch { /* not ready yet */ }
    wasConnected = false;
    statusDot.classList.remove('connected');
    statusText.textContent = 'Connecting...';
    setTimeout(pollBackendHealth, 2000);
  }

  /* ── Model Scanning ──────────────────────────────────────── */
  async function scanModels() {
    modelSelect.innerHTML = '<option value="auto">✨ Auto Select</option>';
    btnScanModels.querySelector('svg').style.animation = 'spin 0.7s linear infinite';

    try {
      const resp = await fetch(`http://localhost:${backendPort}/api/models/scan`);
      const data = await resp.json();

      modelSelect.innerHTML = '<option value="auto" selected>✨ Auto Select</option>';
      if (data.models && data.models.length > 0) {
        /* Group by provider */
        const groups = {};
        data.models.forEach(m => {
          const provider = m.provider || 'Other';
          if (!groups[provider]) groups[provider] = [];
          groups[provider].push(m);
        });

        Object.entries(groups).forEach(([provider, models]) => {
          const optgroup = document.createElement('optgroup');
          optgroup.label = provider;
          models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id || m.name;
            opt.textContent = m.name;
            optgroup.appendChild(opt);
          });
          modelSelect.appendChild(optgroup);
        });
      } else {
        const opt = document.createElement('option');
        opt.value = "";
        opt.textContent = "No models found";
        modelSelect.appendChild(opt);
      }
      currentModel = 'auto';
    } catch {
      modelSelect.innerHTML = '<option value="auto">✨ Auto Select</option><option value="">Backend offline</option>';
      currentModel = 'auto';
    }

    btnScanModels.querySelector('svg').style.animation = '';
  }

  btnScanModels.addEventListener('click', scanModels);
  modelSelect.addEventListener('change', () => { currentModel = modelSelect.value; });


  /* ── Chat Prompt Cards & Chips (Quick Actions) ──────────────────────────── */
  document.querySelectorAll('.chat-chip, .prompt-card').forEach(card => {
    card.addEventListener('click', async () => {
      const action = card.dataset.action;
      let prompt = '';
      if (action === 'summarize') {
        const content = await plutoAPI.getPageContent();
        prompt = `Summarize this page:\n\n${content}`;
      } else if (action === 'extract') {
        const content = await plutoAPI.getPageContent();
        prompt = `Extract the key data from this page into a structured format:\n\n${content}`;
      } else if (action === 'codechef') {
        prompt = `/codechef resume the course and complete all coding and MCQ problems. Verify runs are successful before submitting, and only click Next after Correct Answer is shown on screen.`;
      } else if (action === 'act') {
        chatInput.value = 'Open YouTube and search for Pluto AI Agent';
        chatInput.focus();
        return;
      }
      if (prompt) {
        chatInput.value = prompt;
        sendMessage();
      }
    });
  });

  /* ── Sending Messages ───────────────────────────────────── */
  btnSend.addEventListener('click', () => {
    if (isStreaming) {
      stopExecution();
    } else {
      sendMessage();
    }
  });

  chatInput.addEventListener('keydown', (e) => {
    if (skillsPopup && !skillsPopup.classList.contains('hidden')) {
      const items = skillsList.querySelectorAll('.skills-list-item');
      if (items.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          items[selectedSkillIndex].classList.remove('selected');
          selectedSkillIndex = (selectedSkillIndex + 1) % items.length;
          items[selectedSkillIndex].classList.add('selected');
          items[selectedSkillIndex].scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          items[selectedSkillIndex].classList.remove('selected');
          selectedSkillIndex = (selectedSkillIndex - 1 + items.length) % items.length;
          items[selectedSkillIndex].classList.add('selected');
          items[selectedSkillIndex].scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const name = items[selectedSkillIndex].querySelector('.skills-item-name').textContent;
          insertSkill(name);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          hideSkillsPopup();
          return;
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        stopExecution();
      } else {
        sendMessage();
      }
    }
  });

  /* Toggle Agent Mode */
  if (btnAgentMode) {
    btnAgentMode.addEventListener('click', () => {
      isAgentMode = !isAgentMode;
      btnAgentMode.classList.toggle('agent-active', isAgentMode);
    });
  }

  /* Auto-resize textarea & Autocomplete trigger */
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    handleSkillsAutocomplete();
  });

  function handleSkillsAutocomplete() {
    if (!skillsPopup || !skillsList) return;
    const text = chatInput.value;
    const selectionEnd = chatInput.selectionEnd;
    const textBeforeCursor = text.substring(0, selectionEnd);
    const words = textBeforeCursor.split(/\s+/);
    const lastWord = words[words.length - 1];

    if (lastWord && lastWord.startsWith('/')) {
      const search = lastWord.toLowerCase();
      const matches = availableSkills.filter(s => s.name.toLowerCase().startsWith(search));
      if (matches.length > 0) {
        renderSkillsPopup(matches, search);
        return;
      }
    }
    hideSkillsPopup();
  }

  function renderSkillsPopup(matches, search) {
    skillsList.innerHTML = '';
    selectedSkillIndex = 0;
    
    matches.forEach((s, idx) => {
      const item = document.createElement('div');
      item.className = 'skills-list-item' + (idx === 0 ? ' selected' : '');
      item.innerHTML = `
        <span class="skills-item-name">${s.name}</span>
        <span class="skills-item-desc">${s.description}</span>
      `;
      item.addEventListener('click', () => {
        insertSkill(s.name);
      });
      skillsList.appendChild(item);
    });
    skillsPopup.classList.remove('hidden');
  }

  function hideSkillsPopup() {
    if (skillsPopup) skillsPopup.classList.add('hidden');
    selectedSkillIndex = -1;
  }

  function insertSkill(name) {
    const text = chatInput.value;
    const words = text.split(/\s+/);
    words[words.length - 1] = name;
    chatInput.value = words.join(' ') + ' ';
    chatInput.focus();
    hideSkillsPopup();
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text && attachments.length === 0) return;
    if (isStreaming) return;

    /* Hide welcome */
    if (chatWelcome) chatWelcome.remove();

    /* Build message */
    const userMsg = { role: 'user', content: text, attachments: [...attachments] };
    messages.push(userMsg);
    appendUserBubble(text, attachments);

    /* Clear inputs */
    chatInput.value = '';
    chatInput.style.height = 'auto';
    clearAttachments();

    /* Determine if this is an agent task or direct chat */
    const isAgentTask = isAgentMode ||
                        text.toLowerCase().includes('act for me') ||
                        text.toLowerCase().includes('do this') ||
                        text.toLowerCase().includes('fill') ||
                        text.toLowerCase().includes('click') ||
                        text.toLowerCase().includes('navigate to') ||
                        text.toLowerCase().includes('book') ||
                        text.toLowerCase().includes('search for') ||
                        text.toLowerCase().includes('open') ||
                        text.toLowerCase().includes('go to') ||
                        text.toLowerCase().includes('browse') ||
                        text.toLowerCase().includes('visit');

    /* Auto Select Model Routing */
    let modelToUse = currentModel;
    if (currentModel === 'auto' || !currentModel) {
      const route = autoRouteModel(isAgentTask);
      modelToUse = route.id;
      
      const routeLog = document.createElement('div');
      routeLog.className = 'agent-step';
      routeLog.style.margin = '8px 12px';
      routeLog.style.padding = '6px 10px';
      routeLog.style.background = 'rgba(99, 102, 241, 0.06)';
      routeLog.style.border = '1px dashed rgba(99, 102, 241, 0.2)';
      routeLog.style.borderRadius = 'var(--radius-md)';
      routeLog.style.fontSize = '11.5px';
      routeLog.style.color = 'var(--pluto-accent-light)';
      
      if (route.type === 'action') {
        routeLog.innerHTML = `⚙️ <strong>[Auto Select]</strong> Detected Browser Action task.<br>⚡ Routing to Fast Vision Model: <span style="color:#fff">${route.name}</span>`;
      } else {
        routeLog.innerHTML = `🧠 <strong>[Auto Select]</strong> Detected Reasoning/Chat task.<br>💭 Routing to Thinking Model: <span style="color:#fff">${route.name}</span>`;
      }
      chatMessages.appendChild(routeLog);
      scrollToBottom();
    }

    if (isAgentTask) {
      await runAgent(text, modelToUse);
    } else {
      await streamChat(text, modelToUse);
    }
  }

  /* ── Direct Chat (SSE) ───────────────────────────────────── */
  async function streamChat(prompt, modelToUse) {
    setStreamingUI(true);
    const aiBubble = appendAiBubbleEmpty();
    showTyping(true);

    try {
      const pageUrl = await plutoAPI.getActiveUrl();
      const body = JSON.stringify({
        message: prompt,
        model: modelToUse,
        context_url: pageUrl,
        attachments: attachments.map(a => ({ type: a.type, data: a.data })),
      });

      const resp = await fetch(`http://localhost:${backendPort}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!resp.ok) {
        aiBubble.textContent = `Error: ${resp.statusText}`;
        showTyping(false);
        isStreaming = false;
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                accumulated += parsed.content;
                aiBubble.textContent = accumulated;
              }
            } catch {
              accumulated += data;
              aiBubble.textContent = accumulated;
            }
          }
        }
        scrollToBottom();
      }

      if (!accumulated) aiBubble.textContent = 'No response received.';
      messages.push({ role: 'assistant', content: accumulated });

    } catch (err) {
      aiBubble.textContent = `Connection error: ${err.message}`;
    }

    showTyping(false);
    setStreamingUI(false);
  }

  /* ── Agent Execution (SSE) ───────────────────────────────── */
  async function runAgent(task, modelToUse) {
    setStreamingUI(true);
    webSlot.classList.add('agent-active');

    // Query settings to determine if glow feedback is enabled
    let glowEnabled = true;
    try {
      const resp = await fetch(`http://localhost:${backendPort}/api/settings`);
      if (resp.ok) {
        const data = await resp.json();
        const prefs = data.preferences || {};
        glowEnabled = prefs['toggle-agent-glow'] !== false; // default to true
      }
    } catch (e) {
      console.error('[sidebar] Failed to fetch settings:', e);
    }

    if (glowEnabled) {
      webSlot.classList.add('glow-enabled');
    }

    // Notify main process via IPC
    try {
      if (window.plutoAPI && window.plutoAPI.setAgentState) {
        await window.plutoAPI.setAgentState(true, glowEnabled);
      }
    } catch (ipcErr) {
      console.error('[sidebar] IPC setAgentState failed:', ipcErr);
    }

    /* Bouncing dots Agent Thinking Card */
    const thinkingCard = document.createElement('div');
    thinkingCard.className = 'typing-indicator';
    thinkingCard.style.marginTop = '8px';
    thinkingCard.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <span style="font-size: 11.5px; font-weight: 500; color: var(--pluto-text-secondary); margin-left: 6px;">Agent is thinking...</span>
    `;
    chatMessages.appendChild(thinkingCard);

    const stepContainer = document.createElement('div');
    stepContainer.className = 'agent-steps-accordion';
    stepContainer.innerHTML = `
      <div class="agent-steps-header">
        <div class="agent-steps-header-left">
          <span class="agent-steps-spinner">🧠</span>
          <span class="agent-steps-header-text">Pluto is analyzing the page...</span>
        </div>
        <span class="breakdown-toggle">[ View Breakdown ▾ ]</span>
      </div>
      <div class="agent-steps-body collapsed"></div>
    `;

    const header = stepContainer.querySelector('.agent-steps-header');
    const body = stepContainer.querySelector('.agent-steps-body');
    const toggle = stepContainer.querySelector('.breakdown-toggle');

    header.addEventListener('click', () => {
      const isCollapsed = body.classList.toggle('collapsed');
      toggle.textContent = isCollapsed ? '[ View Breakdown ▾ ]' : '[ Hide Breakdown ▴ ]';
    });

    chatMessages.appendChild(stepContainer);
    
    // Ensure thinkingCard stays at the very bottom
    chatMessages.appendChild(thinkingCard);
    scrollToBottom();

    const cleanupAgentState = async () => {
      webSlot.classList.remove('agent-active');
      webSlot.classList.remove('glow-enabled');
      try {
        if (window.plutoAPI && window.plutoAPI.setAgentState) {
          await window.plutoAPI.setAgentState(false, false);
        }
      } catch (ipcErr) {}
    };

    try {
      const url = await plutoAPI.getActiveUrl();
      const sseUrl = `http://localhost:${backendPort}/api/run?task=${encodeURIComponent(task)}&model=${encodeURIComponent(modelToUse)}&url=${encodeURIComponent(url)}`;

      const evtSource = new EventSource(sseUrl);
      abortCtrl = evtSource;

      evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.type === 'step') {
            appendAgentStep(stepContainer, data.content);
            // Push thinkingCard back to bottom after appending step
            chatMessages.appendChild(thinkingCard);
          } else if (data.type === 'result') {
            const aiBubble = appendAiBubbleEmpty();
            aiBubble.textContent = data.content;
            messages.push({ role: 'assistant', content: data.content });
            chatMessages.appendChild(thinkingCard);
          } else if (data.type === 'error') {
            appendAgentStep(stepContainer, `❌ ${data.content}`);
            chatMessages.appendChild(thinkingCard);
          } else if (data.type === 'done') {
            evtSource.close();
            thinkingCard.remove();
            cleanupAgentState();
            setStreamingUI(false);
          }
        } catch { /* ignore parse errors */ }
        scrollToBottom();
      };

      evtSource.onerror = () => {
        evtSource.close();
        thinkingCard.remove();
        cleanupAgentState();
        setStreamingUI(false);
      };

    } catch (err) {
      thinkingCard.remove();
      cleanupAgentState();
      setStreamingUI(false);
      appendAgentStep(stepContainer, `❌ Failed: ${err.message}`);
    }
  }

  /* ── New Chat ────────────────────────────────────────────── */
  btnNewChat.addEventListener('click', () => {
    messages = [];
    chatMessages.innerHTML = `
      <div class="chat-welcome" id="chat-welcome">
        <div class="chat-welcome-icon">P</div>
        <h2>Pluto Agent</h2>
        <p>Ask me anything, or let me act on this page for you.</p>
        <div class="chat-chips">
          <button class="chat-chip" data-action="summarize">Summarize this page</button>
          <button class="chat-chip" data-action="extract">Extract data</button>
          <button class="chat-chip" data-action="act">Act for me</button>
        </div>
      </div>
    `;
    /* Re-bind chip listeners */
    chatMessages.querySelectorAll('.chat-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const action = chip.dataset.action;
        if (action === 'summarize') {
          const content = await plutoAPI.getPageContent();
          chatInput.value = `Summarize this page:\n\n${content}`;
          sendMessage();
        } else if (action === 'extract') {
          const content = await plutoAPI.getPageContent();
          chatInput.value = `Extract the key data:\n\n${content}`;
          sendMessage();
        } else if (action === 'act') {
          chatInput.value = '';
          chatInput.placeholder = 'Describe what I should do...';
          chatInput.focus();
        }
      });
    });
  });

  /* ── Attachments ─────────────────────────────────────────── */
  btnAttachSource.addEventListener('click', () => {
    const url = prompt('Enter source URL:');
    if (url) addAttachment({ type: 'url', data: url, name: new URL(url).hostname });
  });

  btnAttachImage.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        addAttachment({ type: 'image', data: ev.target.result, name: file.name });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });

  btnPasteClip.addEventListener('click', async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
          const blob = await item.getType(item.types.find(t => t.startsWith('image/')));
          const reader = new FileReader();
          reader.onload = (ev) => {
            addAttachment({ type: 'image', data: ev.target.result, name: 'clipboard.png' });
          };
          reader.readAsDataURL(blob);
        } else if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          addAttachment({ type: 'text', data: text, name: 'Pasted text' });
        }
      }
    } catch {
      /* Fallback to text clipboard */
      const text = await navigator.clipboard.readText();
      if (text) addAttachment({ type: 'text', data: text, name: 'Pasted text' });
    }
  });

  function addAttachment(att) {
    attachments.push(att);
    renderAttachments();
  }

  function clearAttachments() {
    attachments = [];
    attachmentsBar.innerHTML = '';
  }

  function renderAttachments() {
    attachmentsBar.innerHTML = '';
    attachments.forEach((att, idx) => {
      const el = document.createElement('div');
      el.className = 'attachment-item';

      let preview = '';
      if (att.type === 'image') {
        preview = `<img class="attachment-thumb" src="${att.data}" alt="">`;
      } else if (att.type === 'url') {
        preview = `<svg style="width:14px;height:14px;fill:var(--pluto-info)" viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1z"/></svg>`;
      } else {
        preview = `<svg style="width:14px;height:14px;fill:var(--pluto-text-tertiary)" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/></svg>`;
      }

      el.innerHTML = `
        ${preview}
        <span class="truncate" style="max-width:80px;font-size:10px">${escapeHtml(att.name)}</span>
        <button class="attachment-remove" data-idx="${idx}">
          <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      `;

      el.querySelector('.attachment-remove').addEventListener('click', () => {
        attachments.splice(idx, 1);
        renderAttachments();
      });

      attachmentsBar.appendChild(el);
    });
  }

  /* ── AI Settings Button → Navigate to settings ───────────── */
  btnSideSettings.addEventListener('click', () => {
    plutoAPI.navigateTo('pluto://settings');
  });

  /* ── UI Helpers ──────────────────────────────────────────── */
  function appendUserBubble(text, atts) {
    const msg = document.createElement('div');
    msg.className = 'msg msg-user';
    msg.innerHTML = `
      <div class="msg-avatar">U</div>
      <div class="msg-body">
        <div class="msg-bubble">${escapeHtml(text)}</div>
      </div>
    `;
    chatMessages.appendChild(msg);
    scrollToBottom();
  }

  function appendAiBubbleEmpty() {
    const msg = document.createElement('div');
    msg.className = 'msg msg-ai';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = '';

    msg.innerHTML = `<div class="msg-avatar">P</div>`;
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.appendChild(bubble);
    msg.appendChild(body);
    chatMessages.appendChild(msg);
    scrollToBottom();
    return bubble;
  }

  function appendAgentStep(container, text) {
    const target = container.querySelector('.agent-steps-body') || container;
    const step = document.createElement('div');
    step.className = 'agent-step';

    const trimmed = text.trim();
    if (!trimmed) return;

    let html = '';
    let icon = `🧠`;

    if (trimmed.startsWith('📍')) {
      step.classList.add('agent-step-header-log');
      html = `<strong>${escapeHtml(trimmed)}</strong>`;
      icon = `🧠`;
    } else if (trimmed.startsWith('❔')) {
      html = `<span class="step-label">Eval:</span> <span class="step-value">${escapeHtml(trimmed.slice(2).replace(/^Eval:\s*/i, ''))}</span>`;
      icon = `🧐`;
    } else if (trimmed.startsWith('🧠')) {
      html = `<span class="step-label">Memory:</span> <span class="step-value">${escapeHtml(trimmed.slice(2).replace(/^Memory:\s*/i, ''))}</span>`;
      icon = `💭`;
    } else if (trimmed.startsWith('🎯')) {
      html = `<span class="step-label">Next Goal:</span> <span class="step-value">${escapeHtml(trimmed.slice(2).replace(/^Next goal:\s*/i, ''))}</span>`;
      icon = `🎯`;
    } else if (trimmed.startsWith('▶️')) {
      html = `<span class="step-label-action">Executing:</span> <span class="step-value-action">${escapeHtml(trimmed.slice(2))}</span>`;
      icon = `🔄`;
      step.classList.add('agent-step-active');
    } else if (trimmed.startsWith('🔗') || trimmed.startsWith('🖱️') || trimmed.startsWith('✅') || trimmed.includes('complete') || trimmed.includes('successful')) {
      html = `<span>${escapeHtml(trimmed)}</span>`;
      icon = `✅`;
      step.classList.add('agent-step-done');
    } else if (trimmed.startsWith('⚠️') || trimmed.startsWith('🛑')) {
      html = `<span style="color:var(--pluto-warning)">${escapeHtml(trimmed)}</span>`;
      icon = `⚠️`;
    } else if (trimmed.startsWith('❌')) {
      html = `<span style="color:var(--pluto-danger)">${escapeHtml(trimmed)}</span>`;
      icon = `❌`;
    } else if (trimmed.startsWith('📢') || trimmed.includes('=')) {
      html = `<span class="dev-log-pill">${escapeHtml(trimmed)}</span>`;
      icon = `⚙️`;
    } else {
      html = `<span>${escapeHtml(trimmed)}</span>`;
      icon = `👉`;
    }

    let iconHtml = icon;
    if (!icon.startsWith('<') && !icon.startsWith('&')) {
      iconHtml = `<span class="agent-step-emoji">${icon}</span>`;
    }

    step.innerHTML = `
      <div class="agent-step-icon-wrap">${iconHtml}</div>
      <div class="agent-step-content">${html}</div>
    `;
    target.appendChild(step);

    const headerText = container.querySelector('.agent-steps-header-text');
    if (headerText) {
      if (trimmed.startsWith('📍')) {
        headerText.textContent = `Executing ${trimmed.replace('📍', '').trim()}...`;
      } else if (trimmed.startsWith('🎯')) {
        const goalText = trimmed.replace('🎯', '').replace(/^Next goal:\s*/i, '').trim();
        if (goalText) {
          headerText.textContent = `Goal: ${goalText.slice(0, 40)}${goalText.length > 40 ? '...' : ''}`;
        }
      }
    }

    target.scrollTop = target.scrollHeight;
    scrollToBottom();
  }

  function showTyping(show) {
    let existing = chatMessages.querySelector('.typing-indicator');
    if (show && !existing) {
      const el = document.createElement('div');
      el.className = 'typing-indicator';
      el.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;
      chatMessages.appendChild(el);
    } else if (!show && existing) {
      existing.remove();
    }
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ── Drag-and-Drop Images ────────────────────────────────── */
  chatInput.addEventListener('dragover', (e) => { e.preventDefault(); });
  chatInput.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          addAttachment({ type: 'image', data: ev.target.result, name: file.name });
        };
        reader.readAsDataURL(file);
      }
    }
  });

  /* ── Paste Images ────────────────────────────────────────── */
  chatInput.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (ev) => {
          addAttachment({ type: 'image', data: ev.target.result, name: 'pasted.png' });
        };
        reader.readAsDataURL(file);
      }
    }
  });

  /* ── Helper Functions ───────────────────────────────────── */
  function autoRouteModel(isAgentTask) {
    const options = Array.from(modelSelect.options).map(o => o.value);
    const validOptions = options.filter(val => val && val !== 'auto');
    
    if (isAgentTask) {
      // Find a fast action/vision model
      const actionModel = validOptions.find(val => 
        val.toLowerCase().includes('flash') || 
        val.toLowerCase().includes('browseruse') ||
        val.toLowerCase().includes('gpt-4o-mini')
      );
      const selectedId = actionModel || validOptions[0] || '';
      const selectedName = modelSelect.querySelector(`option[value="${selectedId}"]`)?.textContent || 'Default Action Model';
      return { id: selectedId, name: selectedName, type: 'action' };
    } else {
      // Find a thinking/pro model
      const thinkingModel = validOptions.find(val => 
        val.toLowerCase().includes('pro') || 
        val.toLowerCase().includes('claude') || 
        val.toLowerCase().includes('medium')
      );
      const selectedId = thinkingModel || validOptions[0] || '';
      const selectedName = modelSelect.querySelector(`option[value="${selectedId}"]`)?.textContent || 'Default Thinking Model';
      return { id: selectedId, name: selectedName, type: 'thinking' };
    }
  }

  function setStreamingUI(active) {
    isStreaming = active;
    if (active) {
      btnSend.classList.add('streaming-active');
      btnSend.title = 'Stop Execution';
      btnSend.innerHTML = `<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>`;
    } else {
      btnSend.classList.remove('streaming-active');
      btnSend.title = 'Send';
      btnSend.innerHTML = `<svg viewBox="0 0 24 24"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/></svg>`;
    }
  }

  async function stopExecution() {
    if (abortCtrl) {
      abortCtrl.close();
      abortCtrl = null;
    }
    
    setStreamingUI(false);
    webSlot.classList.remove('agent-active');
    webSlot.classList.remove('glow-enabled');
    try {
      if (window.plutoAPI && window.plutoAPI.setAgentState) {
        await window.plutoAPI.setAgentState(false, false);
      }
    } catch (err) {}
    
    /* Remove any thinking indicators */
    const activeIndicators = chatMessages.querySelectorAll('.typing-indicator');
    activeIndicators.forEach(el => {
      // Only remove if it contains the "thinking" text (so we don't accidentally remove standard typing indicators)
      if (el.textContent.includes('thinking')) {
        el.remove();
      }
    });

    const stepContainer = chatMessages.querySelector('.agent-steps-accordion:last-child');
    if (stepContainer) {
      appendAgentStep(stepContainer, '🛑 Execution stopped by user.');
    } else {
      const aiBubble = appendAiBubbleEmpty();
      aiBubble.textContent = '🛑 Execution stopped by user.';
    }
    
    try {
      await fetch(`http://localhost:${backendPort}/api/stop`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to call stop API', e);
    }
  }

  /* ── Boot ─────────────────────────────────────────────────── */
  init();
})();
