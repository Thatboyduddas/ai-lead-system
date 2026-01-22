// Duddas Quotes v2.0.1 - Simple Quote Calculator
// No SalesGod integration - just quick quotes

const VERSION = "2.0.1";

// ============================================
// QUOTE CALCULATION
// ============================================

function calculateQuote(youngestAge, adults, kids) {
  let lowPrice, highPrice;

  // Base price by age of youngest adult
  if (youngestAge < 18) {
    lowPrice = 89;
    highPrice = 189;
  } else if (youngestAge <= 29) {
    lowPrice = 189;
    highPrice = 389;
  } else if (youngestAge <= 39) {
    lowPrice = 219;
    highPrice = 449;
  } else if (youngestAge <= 49) {
    lowPrice = 249;
    highPrice = 519;
  } else if (youngestAge <= 54) {
    lowPrice = 289;
    highPrice = 619;
  } else if (youngestAge <= 59) {
    lowPrice = 349;
    highPrice = 719;
  } else if (youngestAge <= 64) {
    lowPrice = 419;
    highPrice = 849;
  } else {
    // Medicare age
    return { isMedicare: true };
  }

  // Add for spouse (second adult)
  if (adults > 1) {
    lowPrice += Math.round(lowPrice * 0.9);
    highPrice += Math.round(highPrice * 0.9);
  }

  // Add for kids
  if (kids > 0) {
    lowPrice += kids * 89;
    highPrice += kids * 189;
  }

  return { lowPrice, highPrice, isMedicare: false };
}

function generateQuoteMessage(lowPrice, highPrice) {
  return `Assuming you have no major chronic/critical conditions, you can qualify for plans between $${lowPrice}-$${highPrice}/month. Deductibles and networks are customizable with $50 copays for primary care, specialists, and urgent care; $250 for ER; $250 for outpatient surgeries; and $500 for inpatient stays. Maximum out of pocket 5k. Plans include free ACA-compliant preventive care (immunizations, physicals, mammograms, Pap smears, colonoscopies).`;
}

// ============================================
// UI PANEL
// ============================================

function resetPanelPosition(panel) {
  panel.style.top = '100px';
  panel.style.left = '20px';
  panel.style.bottom = 'auto';
  localStorage.removeItem('duddas-quotes-pos');
  showNotif('Position reset!', 'info');
}

function createQuotePanel() {
  // Clear any bad saved position first
  localStorage.removeItem('duddas-quotes-pos');

  const existing = document.getElementById('duddas-quotes');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'duddas-quotes';
  panel.style.cssText = `
    position: fixed;
    top: 100px;
    left: 20px;
    background: linear-gradient(135deg, #0d1424, #1e293b);
    color: white;
    padding: 0;
    border-radius: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    z-index: 99998;
    width: 320px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    border: 1px solid rgba(251,191,36,0.3);
    overflow: hidden;
  `;

  panel.innerHTML = `
    <!-- Header - MAGA Theme -->
    <div id="duddas-header" style="background:linear-gradient(135deg,#991b1b,#1e3a5f);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #fbbf24;cursor:grab;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">🦅</span>
        <span style="font-weight:700;font-size:14px;">Duddas Quotes</span>
        <span style="font-size:10px;color:#a1a1aa;">v${VERSION}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button id="duddas-reset" title="Reset position" style="background:none;border:none;color:#fbbf24;cursor:pointer;font-size:12px;padding:0;">↺</button>
        <button id="duddas-minimize" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0;">−</button>
      </div>
    </div>

    <div id="duddas-content" style="padding:16px;">
      <!-- Coverage Type -->
      <div style="margin-bottom:14px;">
        <label style="font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">Coverage Type</label>
        <select id="duddas-coverage" style="width:100%;background:#1e293b;border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:10px;color:#fff;font-size:13px;cursor:pointer;">
          <option value="employee">Employee Only</option>
          <option value="spouse">Employee + Spouse</option>
          <option value="children">Employee + Children</option>
          <option value="family">Family</option>
        </select>
      </div>

      <!-- Number of Children (hidden by default) -->
      <div id="duddas-kids-row" style="margin-bottom:14px;display:none;">
        <label style="font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">Number of Children</label>
        <select id="duddas-kids" style="width:100%;background:#1e293b;border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:10px;color:#fff;font-size:13px;cursor:pointer;">
          <option value="1">1 Child</option>
          <option value="2">2 Children</option>
          <option value="3">3 Children</option>
          <option value="4">4 Children</option>
          <option value="5">5 Children</option>
        </select>
      </div>

      <!-- Youngest Age -->
      <div style="margin-bottom:14px;">
        <label style="font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">Youngest Policy Holder Age</label>
        <input type="number" id="duddas-age" placeholder="Enter age..." min="1" max="99" style="width:100%;background:#1e293b;border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:10px;color:#fff;font-size:13px;box-sizing:border-box;" />
      </div>

      <!-- Generate Button -->
      <button id="duddas-generate" style="width:100%;background:linear-gradient(135deg,#fbbf24,#b45309);color:#000;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:14px;">
        Generate Quote
      </button>

      <!-- Quote Result (hidden by default) -->
      <div id="duddas-result" style="display:none;background:linear-gradient(135deg,rgba(34,197,94,0.15),rgba(34,197,94,0.05));border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:12px;">
        <div style="font-size:11px;color:#22c55e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:600;">QUOTE</div>
        <div id="duddas-quote-text" style="font-size:13px;color:#fff;line-height:1.5;"></div>
        <button id="duddas-copy" style="margin-top:10px;background:#22c55e;color:#fff;border:none;padding:10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;width:100%;">Copy Quote</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // Make draggable using TOP positioning (not bottom)
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
    let newLeft = e.clientX - dragOffsetX;
    let newTop = e.clientY - dragOffsetY;

    // Keep panel in bounds
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 340));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - 100));

    panel.style.left = newLeft + 'px';
    panel.style.top = newTop + 'px';
    panel.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'grab';
      localStorage.setItem('duddas-quotes-pos', JSON.stringify({
        left: panel.style.left,
        top: panel.style.top
      }));
    }
  });

  // Reset position button
  document.getElementById('duddas-reset').onclick = () => resetPanelPosition(panel);

  // Minimize toggle
  let isMinimized = false;
  document.getElementById('duddas-minimize').onclick = () => {
    isMinimized = !isMinimized;
    document.getElementById('duddas-content').style.display = isMinimized ? 'none' : 'block';
    document.getElementById('duddas-minimize').textContent = isMinimized ? '+' : '−';
  };

  // Coverage type change - show/hide kids selector
  const coverageSelect = document.getElementById('duddas-coverage');
  const kidsRow = document.getElementById('duddas-kids-row');

  coverageSelect.addEventListener('change', () => {
    const val = coverageSelect.value;
    if (val === 'children' || val === 'family') {
      kidsRow.style.display = 'block';
    } else {
      kidsRow.style.display = 'none';
    }
  });

  // Generate quote
  document.getElementById('duddas-generate').onclick = generateQuote;
  document.getElementById('duddas-age').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') generateQuote();
  });

  // Copy button
  document.getElementById('duddas-copy').onclick = () => {
    const text = document.getElementById('duddas-quote-text').textContent;
    navigator.clipboard.writeText(text);
    showNotif('Copied!', 'success');
  };

  // Load saved position after panel is created (use top positioning now)
  const savedPos = JSON.parse(localStorage.getItem('duddas-quotes-pos') || 'null');
  if (savedPos?.left && savedPos?.top) {
    const leftNum = parseInt(savedPos.left);
    const topNum = parseInt(savedPos.top);
    // Only apply if in bounds
    if (leftNum >= 0 && leftNum < window.innerWidth - 100 && topNum >= 0 && topNum < window.innerHeight - 100) {
      panel.style.left = savedPos.left;
      panel.style.top = savedPos.top;
    }
  }
}

function generateQuote() {
  const coverage = document.getElementById('duddas-coverage').value;
  const age = parseInt(document.getElementById('duddas-age').value);
  const kidsCount = parseInt(document.getElementById('duddas-kids').value) || 1;
  const resultDiv = document.getElementById('duddas-result');
  const quoteText = document.getElementById('duddas-quote-text');

  if (!age || age < 1 || age > 99) {
    showNotif('Please enter a valid age', 'error');
    return;
  }

  // Determine adults and kids based on coverage type
  let adults = 1;
  let kids = 0;

  if (coverage === 'spouse') {
    adults = 2;
  } else if (coverage === 'children') {
    adults = 1;
    kids = kidsCount;
  } else if (coverage === 'family') {
    adults = 2;
    kids = kidsCount;
  }

  const quote = calculateQuote(age, adults, kids);

  if (quote.isMedicare) {
    quoteText.textContent = `We don't specialize in Medicare, but here is our referral. Her name is Faith, she's been doing this for over a decade. Text her here +1 (352) 900-3966 or get on her calendar. PLEASE mention Jack referred you!`;
  } else {
    quoteText.textContent = generateQuoteMessage(quote.lowPrice, quote.highPrice);
  }

  resultDiv.style.display = 'block';
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
setTimeout(createQuotePanel, 1000);
