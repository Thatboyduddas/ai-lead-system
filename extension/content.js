const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app/webhook/salesgod";
let lastMessageSent = "";
let lastContactPhone = "";

function extractConversationData() {
  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());
  let contactName = "";
  let phone = "";
  let currentTag = "";
  
  // Find phone
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\+1\s?\d{3}-\d{3}-\d{4}/)) {
      phone = lines[i];
      if (i > 0) contactName = lines[i - 1];
      break;
    }
  }
  
  // Find current tag
  const tags = ['Quoted', 'Age and gender', 'Follow up', 'Ghosted', 'Deadline', 'Sold', 'Appointment Set'];
  for (const tag of tags) {
    if (text.includes(tag)) { currentTag = tag; break; }
  }
  
  // YOUR outgoing message patterns (from Mia/Jack)
  const outgoingPatterns = [
    "it's mia",
    "its mia", 
    "this is mia",
    "hey, it's mia",
    "hi, it's mia",
    "text 0
