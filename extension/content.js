const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app/webhook/salesgod";
let lastSentData = "";

function extractConversationData() {
  let contactName = "";
  let phone = "";
  let currentTag = "";
  let allMessages = [];
  
  // Try to get phone from the page
  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\+1\s?\d{3}-\d{3}-\d{4}/)) {
      phone = lines[i];
      if (i > 0) contactName = lines[i - 1];
      break;
    }
  }
  
  // Find current tag
  const tags = ["Quoted", "Age and gender", "Follow up", "Ghosted", "Deadline", "Sold", "Appointment Set"];
  for (let t = 0; t < tags.length; t++) {
    if (text.includes(tags[t])) { currentTag = tags[t]; break; }
  }
  
  // Try DOM-based extraction first (more accurate)
  // SalesGod typically has message bubbles with different alignment/colors for sent vs received
  const messageBubbles = document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="chat"]');
  
  if (messageBubbles.length > 0) {
    messageBubbles.forEach(bubble => {
      const msgText = bubble.innerText?.trim();
      if (msgText && msgText.length > 0) {
        // Check if this looks like a message (not a button or label)
        const style = window.getComputedStyle(bubble);
        const rect = bubble.getBoundingClientRect();
        
        // Outgoing messages are typically aligned right or have specific classes
        const isOutgoing = 
          bubble.className.toLowerCase().includes('sent') ||
          bubble.className.toLowerCase().includes('outgoing') ||
          bubble.className.toLowerCase().includes('right') ||
          bubble.className.toLowerCase().includes('self') ||
          style.alignSelf === 'flex-end' ||
          style.marginLeft === 'auto' ||
          rect.left > window.innerWidth / 2;
          
        // Skip if it looks like UI element
        if (msgText.length < 500 && !msgText.includes('Type your message')) {
          allMessages.push({
            text: msgText.split('\n')[0], // First line only
            isOutgoing: isOutgoing
          });
        }
      }
    });
  }
  
  // Fallback to text-based extraction if DOM method didn't work well
  if (allMessages.length === 0) {
    const outgoingPatterns = ["mia", "text 0 to opt", "alright, may i have", "alright, what is the age", "assuming you have no major", "touching base", "not sure if you got", "i checked my calendar", "following up", "just so you know", "i found a few", "when works", "do you have some time", "looks like you missed", "did you receive", "are you available", "so you have all the information", "plans include free", "maximum out of pocket", "deductibles and networks", "copays", "primary care", "estes health", "bcbs", "cigna", "blue cross", "aetna", "hi, it's mia", "hi it's mia", "this is mia"];
    
    const timestampPattern = /^\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M$/;
    
    for (let i = 0; i < lines.length; i++) {
      if (timestampPattern.test(lines[i])) {
        let msgIndex = i - 1;
        while (msgIndex >= 0 && lines[msgIndex].trim() === "") { msgIndex--; }
        if (msgIndex >= 0) {
          const msg = lines[msgIndex].trim();
          if (msg.length >= 1 && !timestampPattern.test(msg)) {
            const msgLower = msg.toLowerCase();
            let isOutgoing = false;
            
            for (let p = 0; p < outgoingPatterns.length; p++) {
              if (msgLower.includes(outgoingPatterns[p])) { 
                isOutgoing = true; 
                break; 
              }
            }
            
            // Check for delivery indicators that might follow the timestamp
            // If there's a checkmark or "delivered" after timestamp, it's outgoing
            if (i + 1 < lines.length) {
              const nextLine = lines[i + 1].toLowerCase();
              if (nextLine.includes('delivered') || nextLine.includes('sent') || nextLine.includes('read')) {
                isOutgoing = true;
              }
            }
            
            allMessages.push({
              text: msg,
              timestamp: lines[i],
              isOutgoing: isOutgoing
            });
          }
        }
      }
    }
  }
  
  return { 
    contactName: contactName, 
    phone: phone, 
    currentTag: currentTag, 
    messages: allMessages,
    lastMessage: allMessages.length > 0 ? allMessages[allMessages.length - 1] : null
  };
}

function sendToDashboard(data) {
  if (!data.phone || data.messages.length === 0) return;
  
  const lastMsg = data.lastMessage;
  if (!lastMsg) return;
  
  // Create a hash to avoid duplicate sends
  const dataHash = data.phone + "|" + data.messages.length + "|" + lastMsg.text;
  if (dataHash === lastSentData) return;
  lastSentData = dataHash;
  
  var payload = {
    phone: data.phone,
    full_name: data.contactName,
    messages_as_string: lastMsg.text,
    status: data.currentTag || "new",
    isOutgoing: lastMsg.isOutgoing,
    messageCount: data.messages.length
  };
  
  console.log("AI Lead v3: Sending", payload);
  
  fetch(DASHBOARD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(function(r) { return r.json(); }).then(function(result) {
    console.log("AI Lead v3: Sent!", result);
    showNotification(data.contactName, lastMsg.text, lastMsg.isOutgoing);
  }).catch(function(err) {
    console.error("AI Lead v3: Error", err);
  });
}

function showNotification(name, message, isOutgoing) {
  var existing = document.getElementById("ai-lead-notif");
  if (existing) existing.remove();
  
  var notif = document.createElement("div");
  notif.id = "ai-lead-notif";
  var bgColor = isOutgoing ? "#3b82f6" : "#10b981";
  var direction = isOutgoing ? "↗ You" : "↙ Lead";
  notif.style.cssText = "position:fixed;top:20px;right:20px;background:" + bgColor + ";color:white;padding:15px 20px;border-radius:10px;z-index:99999;font-family:sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:350px;";
  notif.innerHTML = "<strong>Sent to Dashboard</strong><br><small>" + direction + ": " + message.substring(0, 60) + "</small>";
  document.body.appendChild(notif);
  setTimeout(function() { notif.remove(); }, 3000);
}

function startWatching() {
  console.log("AI Lead Intelligence v3: Running (improved detection)");
  
  setInterval(function() {
    var data = extractConversationData();
    if (data.messages.length > 0) { sendToDashboard(data); }
  }, 2000);
  
  document.addEventListener("click", function() {
    setTimeout(function() {
      var data = extractConversationData();
      if (data.messages.length > 0) { sendToDashboard(data); }
    }, 500);
  });
}

startWatching();
