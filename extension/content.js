const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app/webhook/salesgod";
let lastMessageSent = "";
let lastContactPhone = "";

function extractConversationData() {
  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());
  let contactName = "";
  let phone = "";
  let currentTag = "";
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\+1\s?\d{3}-\d{3}-\d{4}/)) {
      phone = lines[i];
      if (i > 0) contactName = lines[i - 1];
      break;
    }
  }
  
  const tags = ["Quoted", "Age and gender", "Follow up", "Ghosted", "Deadline", "Sold", "Appointment Set"];
  for (let t = 0; t < tags.length; t++) {
    if (text.includes(tags[t])) { currentTag = tags[t]; break; }
  }
  
  // Patterns that indicate YOU sent the message (outgoing)
  const outgoingPatterns = ["mia", "text 0 to opt", "alright, may i have", "alright, what is the age", "assuming you have no major", "touching base", "not sure if you got", "i checked my calendar", "following up", "just so you know", "i found a few", "when works", "do you have some time", "looks like you missed", "did you receive", "are you available", "so you have all the information", "plans include free", "maximum out of pocket", "deductibles and networks", "copays", "primary care", "estes health", "bcbs", "cigna", "blue cross", "aetna"];
  
  const timestampPattern = /^\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M$/;
  
  // Get the LAST message (whether incoming or outgoing)
  let lastMessage = "";
  let isOutgoing = false;
  
  for (let i = 0; i < lines.length; i++) {
    if (timestampPattern.test(lines[i])) {
      let msgIndex = i - 1;
      while (msgIndex >= 0 && lines[msgIndex].trim() === "") { msgIndex--; }
      if (msgIndex >= 0) {
        const msg = lines[msgIndex].trim();
        if (msg.length > 2) {
          lastMessage = msg;
          // Check if it's outgoing
          const msgLower = msg.toLowerCase();
          isOutgoing = false;
          for (let p = 0; p < outgoingPatterns.length; p++) {
            if (msgLower.includes(outgoingPatterns[p])) { isOutgoing = true; break; }
          }
        }
      }
    }
  }
  
  return { contactName: contactName, phone: phone, currentTag: currentTag, lastMessage: lastMessage, isOutgoing: isOutgoing };
}

function sendToDashboard(data) {
  if (!data.lastMessage) return;
  if (data.phone === lastContactPhone && data.lastMessage === lastMessageSent) return;
  
  lastMessageSent = data.lastMessage;
  lastContactPhone = data.phone;
  
  var payload = {
    phone: data.phone,
    full_name: data.contactName,
    messages_as_string: data.lastMessage,
    status: data.currentTag || "new",
    isOutgoing: data.isOutgoing
  };
  
  console.log("AI Lead: Sending", payload);
  
  fetch(DASHBOARD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(function(r) { return r.json(); }).then(function(result) {
    console.log("AI Lead: Sent!", result);
    showNotification(data.contactName, data.lastMessage, data.isOutgoing);
  }).catch(function(err) {
    console.error("AI Lead: Error", err);
  });
}

function showNotification(name, message, isOutgoing) {
  var existing = document.getElementById("ai-lead-notif");
  if (existing) existing.remove();
  
  var notif = document.createElement("div");
  notif.id = "ai-lead-notif";
  var bgColor = isOutgoing ? "#3b82f6" : "#10b981";
  var direction = isOutgoing ? "↗ You sent" : "↙ Lead said";
  notif.style.cssText = "position:fixed;top:20px;right:20px;background:" + bgColor + ";color:white;padding:15px 20px;border-radius:10px;z-index:99999;font-family:sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:350px;";
  notif.innerHTML = "<strong>Sent to AI Dashboard</strong><br><small>" + direction + ": " + message.substring(0, 60) + "</small>";
  document.body.appendChild(notif);
  setTimeout(function() { notif.remove(); }, 3000);
}

function startWatching() {
  console.log("AI Lead Intelligence v2: Running (captures all messages)");
  
  setInterval(function() {
    var data = extractConversationData();
    if (data.lastMessage) { sendToDashboard(data); }
  }, 2000);
  
  document.addEventListener("click", function() {
    setTimeout(function() {
      var data = extractConversationData();
      if (data.lastMessage) { sendToDashboard(data); }
    }, 500);
  });
}

startWatching();
