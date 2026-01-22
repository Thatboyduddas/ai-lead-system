// Duddas Quotes v1.0 - Simple Quote Tool
// MAGA Theme - Focus on quoting clients

const VERSION = "1.0.1";
const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app";

let currentPhone = null;
let currentName = null;

// ============================================
// QUOTE CALCULATION
// ============================================

function calculateQuote(adults, kids, youngestAge) {
  let bracket, lowPrice, highPrice;

  if (youngestAge < 18) {
    bracket = 'child';
    lowPrice = 89;
    highPrice = 189;
  } else if (youngestAge <= 29) {
    bracket = 'young';
    lowPrice = 189;
    highPrice = 389;
  } else if (youngestAge <= 39) {
    bracket = '30s';
    lowPrice = 219;
    highPrice = 449;
  } else if (youngestAge <= 49) {
    bracket = '40s';
    lowPrice = 249;
    highPrice = 519;
  } else if (youngestAge <= 54) {
    bracket = '50-54';
    lowPrice = 289;
    highPrice = 619;
  } else if (youngestAge <= 59) {
    bracket = '55-59';
    lowPrice = 349;
    highPrice = 719;
  } else if (youngestAge <= 64) {
    bracket = '60-64';
    lowPrice = 419;
    highPrice = 849;
  } else {
    bracket = 'medicare';
    lowPrice = 0;
    highPrice = 0;
  }

  // Add for additional adults
  if (adults > 1) {
    lowPrice += (adults - 1) * Math.round(lowPrice * 0.9);
    highPrice += (adults - 1) * Math.round(highPrice * 0.9);
  }

  // Add for kids
  if (kids > 0) {
    lowPrice += kids * 89;
    highPrice += kids * 189;
  }

  return { bracket, lowPrice, highPrice };
}

function generateQuoteMessage(lowPrice, highPrice) {
  return `Assuming you have no major chronic/critical conditions, you can qualify for plans between $${lowPrice}-$${highPrice}/month. Deductibles and networks are customizable with $50 copays for primary care, specialists, and urgent care; $250 for ER; $250 for outpatient surgeries; and $500 for inpatient stays. Maximum out of pocket 5k. Plans include free ACA-compliant preventive care (immunizations, physicals, mammograms, Pap smears, colonoscopies).`;
}

// ============================================
// MESSAGE ANALYSIS
// ============================================

function detectAgeGender(message) {
  const text = message.toLowerCase();
  const ages = [];
  let adults = 0;
  let kids = 0;

  // Pattern: "30 male", "45 female", "32m", "28f", "I'm 35", "age 42"
  const agePatterns = [
    /(\d{1,2})\s*(years?\s*old|y\/?o|male|female|m|f)\b/gi,
    /\b(i'?m|i am|age)\s*(\d{1,2})\b/gi,
    /\b(\d{1,2})\s*(and|&)\s*(\d{1,2})\b/gi,
    /\bjust\s*me\s*.*?(\d{1,2})/gi
  ];

  // Extract ages
  for (const pattern of agePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const age = parseInt(match[1]) || parseInt(match[2]) || parseInt(match[3]);
      if (age >= 1 && age <= 99 && !ages.includes(age)) {
        ages.push(age);
      }
    }
  }

  // Also check for simple number patterns like "30 male"
  const simplePattern = /\b(\d{1,2})\s*(male|female|m|f)?\b/gi;
  let match;
  while ((match = simplePattern.exec(text)) !== null) {
    const age = parseInt(match[1]);
    if (age >= 18 && age <= 85 && !ages.includes(age)) {
      ages.push(age);
    }
  }

  // Count adults vs kids
  for (const age of ages) {
    if (age >= 18) {
      adults++;
    } else {
      kids++;
    }
  }

  const youngestAge = ages.length > 0 ? Math.min(...ages) : null;

  return {
    hasAgeInfo: ages.length > 0,
    ages,
    adults: adults || 1,
    kids,
    youngestAge
  };
}

function analyzeMessage(message) {
  const text = message.toLowerCase();

  // Check for age/gender info
  const ageInfo = detectAgeGender(message);
  if (ageInfo.hasAgeInfo && ageInfo.youngestAge && ageInfo.youngestAge < 65) {
    const quote = calculateQuote(ageInfo.adults, ageInfo.kids, ageInfo.youngestAge);
    return {
      type: 'quote',
      suggestion: generateQuoteMessage(quote.lowPrice, quote.highPrice),
      info: `${ageInfo.adults} adult(s), ${ageInfo.kids} kid(s), ages: ${ageInfo.ages.join(', ')}`
    };
  }

  // Check for Medicare (65+)
  if (ageInfo.hasAgeInfo && ageInfo.youngestAge && ageInfo.youngestAge >= 65) {
    return {
      type: 'medicare',
      suggestion: `We don't specialize in Medicare, but here is our referral. Her name is Faith, she's been doing this for over a decade. Text her here +1 (352) 900-3966 or get on her calendar. PLEASE mention Jack referred you!`,
      info: 'Medicare age detected'
    };
  }

  // Check for interest signals - ask for age to generate quote
  const interestWords = ['yes', 'sure', 'ok', 'okay', 'interested', 'tell me more', 'how much', 'quote', 'price', 'sounds good', 'go ahead'];
  if (interestWords.some(w => text.includes(w))) {
    return {
      type: 'interest',
      suggestion: "For the private insurance, all I need is your age and I can get you an accurate quote!",
      info: 'Interest detected - need age'
    };
  }

  // Default - ask for age
  return {
    type: 'default',
    suggestion: "For the private insurance, all I need is your age and I can get you an accurate quote!",
    info: 'Need age for quote'
  };
}

// ============================================
// CONVERSATION EXTRACTION
// ============================================

function extractConversationData() {
  let contactName = "";
  let phone = "";
  let allMessages = [];

  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());

  // Find phone number in the conversation header
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\+1\s?\d{3}-\d{3}-\d{4}/) || lines[i].match(/^\+1\d{10}/)) {
      phone = lines[i];
      if (i > 0) contactName = lines[i - 1];
      break;
    }
  }

  if (phone) currentPhone = phone.replace(/[^0-9+]/g, '');
  if (contactName) currentName = contactName;

  // Extract messages
  const messageElements = document.querySelectorAll('li.chat-list, li[class*="chat-list"]');
  messageElements.forEach(li => {
    const classList = li.className || '';
    const isOutgoing = classList.includes('right');
    const isIncoming = classList.includes('left');

    const messageDiv = li.querySelector('.message, [class*="message"], .flex-column');
    let msgText = messageDiv ? messageDiv.innerText?.trim() : li.innerText?.trim();

    // Clean up
    msgText = msgText
      .replace(/\d{1,2}\/\d{1,2}\/\d{4},?\s*\d{1,2}:\d{2}(:\d{2})?\s*[AP]M/gi, '')
      .replace(/^\s*sent\s*$/i, '')
      .replace(/^\s*delivered\s*$/i, '')
      .trim();

    if (msgText && msgText.length > 0 && msgText.length < 2000 && (isOutgoing || isIncoming)) {
      allMessages.push({
        text: msgText,
        isOutgoing: isOutgoing
      });
    }
  });

  return {
    contactName,
    phone,
    messages: allMessages,
    lastMessage: allMessages[allMessages.length - 1] || null,
    lastIncoming: [...allMessages].reverse().find(m => !m.isOutgoing) || null
  };
}

// ============================================
// AI PANEL UI
// ============================================

function createAIPanel() {
  const existing = document.getElementById('duddas-quotes');
  if (existing) existing.remove();

  // Load saved position
  const savedPos = JSON.parse(localStorage.getItem('duddas-quotes-pos') || 'null');
  const startLeft = savedPos?.left || '20px';
  const startBottom = savedPos?.bottom || '20px';

  const panel = document.createElement('div');
  panel.id = 'duddas-quotes';
  panel.style.cssText = `
    position: fixed;
    bottom: ${startBottom};
    left: ${startLeft};
    background: linear-gradient(135deg, #0d1424, #1e293b);
    color: white;
    padding: 0;
    border-radius: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    z-index: 99998;
    width: 340px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    border: 1px solid rgba(251,191,36,0.3);
    overflow: hidden;
  `;

  panel.innerHTML = `
    <!-- Header (draggable) - MAGA Theme -->
    <div id="duddas-header" style="background:linear-gradient(135deg,#991b1b,#1e3a5f);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #fbbf24;cursor:grab;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">🦅</span>
        <span style="font-weight:700;font-size:14px;">Duddas Quotes</span>
        <span style="font-size:10px;color:#a1a1aa;">v${VERSION}</span>
      </div>
      <button id="duddas-minimize" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0;">−</button>
    </div>

    <div id="duddas-content" style="padding:12px;">
      <!-- Current Lead Info -->
      <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Current Lead</div>
        <div id="duddas-lead-name" style="font-weight:600;color:#fff;">No conversation open</div>
        <div id="duddas-lead-phone" style="font-size:11px;color:#a1a1aa;"></div>
        <div id="duddas-lead-info" style="font-size:10px;color:#fbbf24;margin-top:4px;"></div>
      </div>

      <!-- Suggested Response -->
      <div id="duddas-suggestion-box" style="display:none;background:linear-gradient(135deg,rgba(34,197,94,0.15),rgba(34,197,94,0.05));border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-size:11px;color:#22c55e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">SUGGESTED RESPONSE</div>
        <div id="duddas-suggestion-text" style="font-size:13px;color:#fff;line-height:1.4;max-height:100px;overflow-y:auto;"></div>
        <button id="duddas-copy" style="margin-top:8px;background:#22c55e;color:#fff;border:none;padding:8px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;width:100%;">Copy Response</button>
      </div>

      <!-- AI Chat Input -->
      <div style="margin-bottom:10px;">
        <div style="font-size:11px;color:#71717a;margin-bottom:6px;">Ask AI to adjust the response:</div>
        <div style="display:flex;gap:8px;">
          <input type="text" id="duddas-ai-input" placeholder="e.g. push for phone call, sound less AI..." style="flex:1;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px;color:#fff;font-size:12px;outline:none;" />
          <button id="duddas-ai-send" style="background:linear-gradient(135deg,#fbbf24,#b45309);color:#000;border:none;padding:10px 14px;border-radius:8px;font-weight:700;cursor:pointer;">Go</button>
        </div>
      </div>

      <!-- Quick Actions -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="duddas-quick" data-action="call" style="background:rgba(59,130,246,0.2);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:6px 10px;border-radius:6px;font-size:10px;cursor:pointer;">Push Call</button>
        <button class="duddas-quick" data-action="casual" style="background:rgba(168,85,247,0.2);border:1px solid rgba(168,85,247,0.3);color:#c084fc;padding:6px 10px;border-radius:6px;font-size:10px;cursor:pointer;">More Casual</button>
        <button class="duddas-quick" data-action="urgent" style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:6px 10px;border-radius:6px;font-size:10px;cursor:pointer;">Add Urgency</button>
        <button id="duddas-refresh" style="background:rgba(251,191,36,0.2);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;padding:6px 10px;border-radius:6px;font-size:10px;cursor:pointer;">Refresh</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // Make draggable
  const header = document.getElementById('duddas-header');
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    header.style.cursor = 'grabbing';
    const rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newLeft = e.clientX - dragOffsetX;
    const newTop = e.clientY - dragOffsetY;
    const newBottom = window.innerHeight - newTop - panel.offsetHeight;
    panel.style.left = newLeft + 'px';
    panel.style.bottom = newBottom + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'grab';
      localStorage.setItem('duddas-quotes-pos', JSON.stringify({
        left: panel.style.left,
        bottom: panel.style.bottom
      }));
    }
  });

  // Minimize toggle
  let isMinimized = false;
  document.getElementById('duddas-minimize').onclick = () => {
    isMinimized = !isMinimized;
    document.getElementById('duddas-content').style.display = isMinimized ? 'none' : 'block';
    document.getElementById('duddas-minimize').textContent = isMinimized ? '+' : '−';
  };

  // Copy button
  document.getElementById('duddas-copy').onclick = () => {
    const text = document.getElementById('duddas-suggestion-text').textContent;
    navigator.clipboard.writeText(text);
    showNotif('Copied!', 'success');
  };

  // AI input
  const aiInput = document.getElementById('duddas-ai-input');
  const aiSend = document.getElementById('duddas-ai-send');

  aiSend.onclick = () => adjustSuggestion(aiInput.value);
  aiInput.onkeypress = (e) => {
    if (e.key === 'Enter') adjustSuggestion(aiInput.value);
  };

  // Quick action buttons
  document.querySelectorAll('.duddas-quick').forEach(btn => {
    btn.onclick = () => {
      const action = btn.dataset.action;
      if (action === 'call') adjustSuggestion('push for a phone call');
      if (action === 'casual') adjustSuggestion('make it more casual and less AI');
      if (action === 'urgent') adjustSuggestion('add urgency');
    };
  });

  // Refresh button
  document.getElementById('duddas-refresh').onclick = () => updatePanel();
}

// ============================================
// PANEL UPDATES
// ============================================

let currentSuggestion = '';

function updatePanel() {
  const data = extractConversationData();
  const nameEl = document.getElementById('duddas-lead-name');
  const phoneEl = document.getElementById('duddas-lead-phone');
  const infoEl = document.getElementById('duddas-lead-info');
  const suggestionBox = document.getElementById('duddas-suggestion-box');
  const suggestionText = document.getElementById('duddas-suggestion-text');

  if (!nameEl) return;

  if (data.phone && data.lastIncoming) {
    nameEl.textContent = data.contactName || 'Unknown';
    phoneEl.textContent = data.phone;

    // Analyze last incoming message
    const analysis = analyzeMessage(data.lastIncoming.text);
    infoEl.textContent = analysis.info;
    currentSuggestion = analysis.suggestion;
    suggestionText.textContent = analysis.suggestion;
    suggestionBox.style.display = 'block';
  } else if (data.phone) {
    nameEl.textContent = data.contactName || 'Unknown';
    phoneEl.textContent = data.phone;
    infoEl.textContent = 'Waiting for incoming message...';
    suggestionBox.style.display = 'none';
  } else {
    nameEl.textContent = 'No conversation open';
    phoneEl.textContent = '';
    infoEl.textContent = '';
    suggestionBox.style.display = 'none';
  }
}

async function adjustSuggestion(instruction) {
  if (!instruction || !currentSuggestion) return;

  const inputEl = document.getElementById('duddas-ai-input');
  const suggestionText = document.getElementById('duddas-suggestion-text');

  suggestionText.innerHTML = '<span style="color:#fbbf24;">Adjusting...</span>';
  inputEl.value = '';

  try {
    const res = await fetch(DASHBOARD_URL + '/api/adjust-suggestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        original: currentSuggestion,
        instruction: instruction,
        context: currentName || 'the lead'
      })
    });

    const data = await res.json();
    if (data.adjusted) {
      currentSuggestion = data.adjusted;
      suggestionText.textContent = data.adjusted;
    } else {
      suggestionText.textContent = currentSuggestion;
      showNotif('Could not adjust', 'error');
    }
  } catch (err) {
    suggestionText.textContent = currentSuggestion;
    showNotif('Error adjusting', 'error');
  }
}

// ============================================
// NOTIFICATIONS
// ============================================

function showNotif(message, type = 'info') {
  const existing = document.getElementById('duddas-notif');
  if (existing) existing.remove();

  const colors = {
    success: '#22c55e',
    error: '#ef4444',
    info: '#3b82f6'
  };

  const notif = document.createElement('div');
  notif.id = 'duddas-notif';
  notif.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type]};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: -apple-system, sans-serif;
    font-size: 14px;
    font-weight: 600;
    z-index: 99999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  notif.textContent = message;
  document.body.appendChild(notif);

  setTimeout(() => notif.remove(), 2500);
}

// ============================================
// INITIALIZATION
// ============================================

console.log(`🦅 Duddas Quotes v${VERSION} loaded`);

// Create panel after page loads
setTimeout(createAIPanel, 2000);

// Update panel when clicking around
let lastClickTime = 0;
document.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastClickTime < 1000) return;
  lastClickTime = now;
  setTimeout(updatePanel, 500);
});

// Initial update
setTimeout(updatePanel, 3000);
