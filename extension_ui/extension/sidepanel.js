// Backend configuration
const BACKEND_URL = "http://127.0.0.1:8000";

// DOM Elements
const backendStatus = document.getElementById("backend-status");
const cdpBanner = document.getElementById("cdp-banner");
const promptInput = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");
const chatContainer = document.getElementById("chat-container");
const messageList = document.getElementById("message-list");
const welcomeMessage = document.getElementById("welcome-message");
const modelSelect = document.getElementById("model-select");
const scanModelsBtn = document.getElementById("scan-models-btn");

let isRunning = false;
let currentStepCard = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  checkBackendHealth();
  setInterval(checkBackendHealth, 3000);

  // Auto-resize textarea
  promptInput.addEventListener("input", autoResizeTextarea);
  promptInput.addEventListener("keydown", handleTextareaKeydown);

  // Send button
  sendBtn.addEventListener("click", submitTask);

  // Scan button
  scanModelsBtn.addEventListener("click", () => {
    // Add visual rotation effect
    const svg = scanModelsBtn.querySelector(".scan-icon");
    if (svg) {
      svg.style.transform = "rotate(360deg)";
      setTimeout(() => { svg.style.transform = "none"; }, 500);
    }
    checkBackendHealth();
  });

  // Suggestion chips
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      promptInput.value = chip.dataset.prompt;
      autoResizeTextarea();
      promptInput.focus();
    });
  });
});

// Auto-resize input textarea
function autoResizeTextarea() {
  promptInput.style.height = "auto";
  promptInput.style.height = (promptInput.scrollHeight) + "px";
}

// Handle Enter to submit, Shift+Enter for new line
function handleTextareaKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) {
      submitTask();
    }
  }
}

// Check if Python server and Chrome CDP are running
async function checkBackendHealth() {
  if (isRunning) return; // Don't check while running a task
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    if (!res.ok) throw new Error();
    
    const data = await res.json();
    
    // Update Backend connection badge
    backendStatus.className = "status-badge online";
    backendStatus.querySelector(".status-text").textContent = "Connected";
    
    // Update Chrome CDP status banner
    if (data.chrome_cdp_connected) {
      cdpBanner.classList.add("hidden");
      sendBtn.disabled = !promptInput.value.trim();
    } else {
      cdpBanner.classList.remove("hidden");
      sendBtn.disabled = true;
    }

    // Populate/update the models dropdown
    if (data.models) {
      updateModelsDropdown(data.models);
    }
  } catch (error) {
    backendStatus.className = "status-badge offline";
    backendStatus.querySelector(".status-text").textContent = "Backend Offline";
    cdpBanner.classList.add("hidden");
    sendBtn.disabled = true;
  }
}

let lastModelsJson = "";

function updateModelsDropdown(models) {
  const currentJson = JSON.stringify(models);
  if (currentJson === lastModelsJson) return;
  
  lastModelsJson = currentJson;
  const currentValue = modelSelect.value;
  
  // Clear existing options except "auto"
  modelSelect.innerHTML = '<option value="auto">Auto (from .env)</option>';
  
  models.forEach(model => {
    const opt = document.createElement("option");
    opt.value = `${model.provider}:${model.model_id}`;
    opt.textContent = model.label;
    modelSelect.appendChild(opt);
  });
  
  // Restore previously selected model if it is still available
  if (currentValue && Array.from(modelSelect.options).some(opt => opt.value === currentValue)) {
    modelSelect.value = currentValue;
  }
}

// Enable/disable send button based on input text
promptInput.addEventListener("input", () => {
  if (!isRunning && backendStatus.classList.contains("online") && !cdpBanner.classList.contains("hidden")) {
    // Both backend and Chrome need to be active
    sendBtn.disabled = !promptInput.value.trim();
  }
});

// Create and append messages
function appendUserMessage(text) {
  const container = document.createElement("div");
  container.className = "msg-container user";
  
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  
  container.appendChild(bubble);
  messageList.appendChild(container);
  scrollToBottom();
}

function appendAgentContainer() {
  const container = document.createElement("div");
  container.className = "msg-container agent";
  
  const header = document.createElement("div");
  header.className = "agent-header";
  header.innerHTML = `<span>🤖 Agent Progress</span>`;
  
  const stepsContainer = document.createElement("div");
  stepsContainer.className = "agent-steps";
  stepsContainer.id = "agent-steps-list";
  
  container.appendChild(header);
  container.appendChild(stepsContainer);
  messageList.appendChild(container);
  scrollToBottom();
  
  return stepsContainer;
}

function appendStepCard(stepsList, stepNumber) {
  // Set previous card as inactive
  if (currentStepCard) {
    currentStepCard.classList.remove("active");
  }

  const card = document.createElement("div");
  card.className = "step-card active";
  
  const title = document.createElement("div");
  title.className = "step-title";
  title.innerHTML = `<span>📍 Step ${stepNumber}</span><span class="step-time">in progress...</span>`;
  
  const detail = document.createElement("div");
  detail.className = "step-detail";
  
  card.appendChild(title);
  card.appendChild(detail);
  stepsList.appendChild(card);
  scrollToBottom();
  
  currentStepCard = card;
  return detail;
}

function appendDetailItem(stepDetailDiv, icon, label, text, textClass = "") {
  const item = document.createElement("div");
  item.className = "detail-item";
  
  const iconSpan = document.createElement("span");
  iconSpan.className = "detail-icon";
  iconSpan.textContent = icon;
  
  const contentSpan = document.createElement("span");
  contentSpan.className = `detail-text ${textClass}`;
  
  if (label) {
    contentSpan.innerHTML = `<strong>${label}:</strong> ${text}`;
  } else {
    contentSpan.textContent = text;
  }
  
  item.appendChild(iconSpan);
  item.appendChild(contentSpan);
  stepDetailDiv.appendChild(item);
  scrollToBottom();
}

function appendFinalResultCard(stepsList, text, isSuccess = true) {
  // Set final card inactive
  if (currentStepCard) {
    currentStepCard.classList.remove("active");
  }

  const card = document.createElement("div");
  card.className = "final-result-card";
  
  const title = document.createElement("div");
  title.className = "final-result-title";
  title.innerHTML = isSuccess ? `<span>🎉 Task Completed</span>` : `<span>❌ Error Occurred</span>`;
  
  const content = document.createElement("div");
  content.className = "final-result-content";
  content.textContent = text;
  
  card.appendChild(title);
  card.appendChild(content);
  stepsList.appendChild(card);
  scrollToBottom();
}

function appendThinkingLoader(stepsList) {
  const div = document.createElement("div");
  div.className = "thinking-indicator";
  div.id = "thinking-loader";
  div.innerHTML = `<span>Thinking</span><div class="dot-flashing"></div>`;
  stepsList.appendChild(div);
  scrollToBottom();
}

function removeThinkingLoader() {
  const loader = document.getElementById("thinking-loader");
  if (loader) {
    loader.remove();
  }
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Submit prompt to backend
function submitTask() {
  const taskText = promptInput.value.trim();
  if (!taskText) return;
  
  isRunning = true;
  promptInput.value = "";
  autoResizeTextarea();
  
  // Disable inputs
  promptInput.disabled = true;
  sendBtn.disabled = true;
  modelSelect.disabled = true;
  scanModelsBtn.disabled = true;
  
  // Clear welcome message if visible
  if (welcomeMessage) {
    welcomeMessage.style.display = "none";
  }
  
  // Add user prompt to bubble list
  appendUserMessage(taskText);
  
  // Create agent steps list
  const stepsList = appendAgentContainer();
  appendThinkingLoader(stepsList);
  
  let currentStepDetail = null;
  
  // Build Server-Sent Events URL
  const selectedModel = modelSelect.value;
  const sseUrl = `${BACKEND_URL}/api/run?task=${encodeURIComponent(taskText)}&model=${encodeURIComponent(selectedModel)}`;
  const eventSource = new EventSource(sseUrl);
  
  eventSource.onmessage = (event) => {
    const rawLine = event.data;
    
    if (rawLine === "[PING]") return; // Heartbeat
    
    // Extract step numbers: "📍 Step 1:" or "Step 1:"
    const stepMatch = rawLine.match(/(?:📍\s*)?Step\s+(\d+):/i);
    if (stepMatch) {
      removeThinkingLoader();
      const stepNumber = stepMatch[1];
      currentStepDetail = appendStepCard(stepsList, stepNumber);
      appendThinkingLoader(stepsList);
      return;
    }
    
    // Parse Eval
    if (rawLine.includes("Eval:")) {
      if (!currentStepDetail) return;
      const text = rawLine.split("Eval:")[1].trim();
      const isSuccess = text.toLowerCase().includes("success");
      const cssClass = isSuccess ? "eval-success" : "eval-fail";
      const icon = isSuccess ? "👍" : "⚠️";
      appendDetailItem(currentStepDetail, icon, "Eval", text, cssClass);
      return;
    }
    
    // Parse Memory
    if (rawLine.includes("Memory:")) {
      if (!currentStepDetail) return;
      const text = rawLine.split("Memory:")[1].trim();
      appendDetailItem(currentStepDetail, "🧠", "Memory", text);
      return;
    }
    
    // Parse Next Goal
    if (rawLine.includes("Next goal:")) {
      if (!currentStepDetail) return;
      const text = rawLine.split("Next goal:")[1].trim();
      appendDetailItem(currentStepDetail, "🎯", "Next Goal", text);
      return;
    }
    
    // Parse Actions
    if (rawLine.includes("▶️") || rawLine.includes("⌨️") || rawLine.includes("🖱️") || rawLine.includes("🕒") || rawLine.includes("🔗")) {
      if (!currentStepDetail) return;
      // Get the action details
      let cleanAction = rawLine.replace(/▶️|⌨️|🖱️|🕒|🔗/g, "").trim();
      // Remove any prefix like "[tools] " or "[BrowserSession] "
      cleanAction = cleanAction.replace(/^\[tools\]|^\[BrowserSession\]/gi, "").trim();
      
      const badge = document.createElement("div");
      badge.className = "action-badge";
      badge.textContent = cleanAction;
      
      currentStepDetail.appendChild(badge);
      scrollToBottom();
      return;
    }

    // Parse Final Result
    if (rawLine.includes("Final Result:")) {
      // The actual result text will follow this, we will capture it
      return;
    }
    
    // Parse success/error final systems
    if (rawLine.startsWith("SYSTEM: [SUCCESS]")) {
      removeThinkingLoader();
      const text = rawLine.replace("SYSTEM: [SUCCESS]", "").trim();
      appendFinalResultCard(stepsList, text, true);
      closeEventSource(eventSource);
    } else if (rawLine.startsWith("SYSTEM: [ERROR]")) {
      removeThinkingLoader();
      const text = rawLine.replace("SYSTEM: [ERROR]", "").trim();
      appendFinalResultCard(stepsList, text, false);
      closeEventSource(eventSource);
    } else if (rawLine.startsWith("SYSTEM: [DONE]")) {
      closeEventSource(eventSource);
    }
  };
  
  eventSource.onerror = (err) => {
    removeThinkingLoader();
    appendFinalResultCard(stepsList, "Connection lost or server error occurred.", false);
    closeEventSource(eventSource);
  };
}

function closeEventSource(eventSource) {
  eventSource.close();
  isRunning = false;
  promptInput.disabled = false;
  modelSelect.disabled = false;
  scanModelsBtn.disabled = false;
  checkBackendHealth(); // Re-enable send button if appropriate
}
