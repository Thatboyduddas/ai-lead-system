const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// In-memory storage for leads
let leads = [];

// Pricing tables
const PRICING = {
  low: {
    '18-29': { single: 239, spouse: 519, kids: 499, family: 769 },
    '30-44': { single: 249, spouse: 549, kids: 529, family: 789 },
    '45-54': { single: 289, spouse: 619, kids: 579, family: 829 },
    '55-64': { single: 349, spouse: 629, kids: 589, family: 859 }
  },
  high: {
    '18-29': { single: 600, spouse: 1071, kids: 979, family: 1548 },
    '30-44': { single: 619, spouse: 1108, kids: 1013, family: 1603 },
    '45-54': { single: 642, spouse: 1155, kids: 1054, family: 1673 },
    '55-64': { single: 690, spouse: 1250, kids: 1140, family: 1815 }
  }
};

// Get age bracket
function getAgeBracket(age) {
  if (age >= 18 && age <= 29) return '18-29';
  if (age >= 30 && age <= 44) return '30-44';
  if (age >= 45 && age <= 54) return '45-54';
  if (age >= 55 && age <= 64) return '55-64';
  return '30-44';
}

// Calculate quote
function calculateQuote(adults, kids, youngestAge) {
  const bracket = getAgeBracket(youngestAge);
  const low = PRICING.low[bracket];
  const high = PRICING.high[bracket];
  
  let type, lowPrice, highPrice;
  
  if (adults === 1 && kids === 0) {
    type = 'single';
    lowPrice = low.single;
    highPrice = high.single;
  } else if (adults === 2 && kids === 0) {
    type = 'spouse';
    lowPrice = low.spouse;
    highPrice = high.spouse;
  } else if (adults === 1 && kids === 1) {
    type = '1adult1kid';
    lowPrice = Math.round((low.single + low.kids) / 2);
    highPrice = Math.round((high.single + high.kids) / 2);
  } else if (adults === 1 && kids >= 2) {
    type = 'kids';
    lowPrice = low.kids;
    highPrice = high.kids;
  } else if (adults === 2 && kids === 1) {
    type = '2adults1kid';
    lowPrice = Math.round((low.spouse + low.family) / 2);
    highPrice = Math.round((high.spouse + high.family) / 2);
  } else if (adults === 2 && kids >= 2) {
    type = 'family';
    lowPrice = low.family;
    highPrice = high.family;
  } else {
    type = 'single';
    lowPrice = low.single;
    highPrice = high.single;
  }
  
  return { type, lowPrice, highPrice, bracket };
}

// Parse age/gender from message
function parseAgeGender(message) {
  const text = message.toLowerCase();
  const ages = [];
  const patterns = [
    /(\d{1,2})\s*(year|yr|yo|y\/o|years old)?[\s,]*(male|female|m|f)?/gi,
    /(male|female|m|f)\s*(\d{1,2})/gi,
    /i'?m\s*(\d{1,2})/gi,
    /(\d{1,2})\s*(male|female|m|f)/gi
  ];
  
  let match;
  for (const pattern of patterns) {
    while ((match = pattern.exec(text)) !== null) {
      const age = parseInt(match[1]) || parseInt(match[2]);
      if (age >= 18 && age <= 64) ages.push(age);
    }
  }
  
  const kidsPatterns = [
    /(\d+)\s*(kids?|children|child)/i,
    /(one|two|three|four|five)\s*(kids?|children)/i
  ];
  
  let numKids = 0;
  for (const pattern of kidsPatterns) {
    const kidsMatch = text.match(pattern);
    if (kidsMatch) {
      const numMap = { one: 1, two: 2, three: 3, four: 4, five: 5 };
      numKids = numMap[kidsMatch[1].toLowerCase()] || parseInt(kidsMatch[1]) || 1;
      break;
    }
  }
  
  if (text.includes('kid') || text.includes('child')) {
    if (numKids === 0) numKids = 1;
  }
  
  const hasSpouse = text.includes('wife') || text.includes('husband') || text.includes('spouse') || text.includes('partner');
  
  const uniqueAges = [...new Set(ages)];
  let adults = uniqueAges.length || 1;
  if (hasSpouse && adults < 2) adults = 2;
  
  const youngestAge = uniqueAges.length > 0 ? Math.min(...uniqueAges) : null;
  
  return { adults, kids: numKids, youngestAge, rawAges: uniqueAges };
}

// Detect intent from message
function detectIntent(message) {
  const text = message.toLowerCase();
  
  // Check for opt-out
  const stopWords = ['stop', 'unsubscribe', 'remove', 'not interested', 'no thanks', 'leave me alone', 'dont contact', 'don\'t contact', 'already have', 'all good', 'all set', 'im good', 'i\'m good', 'pass', 'no', 'nope', 'nah'];
  for (const word of stopWords) {
    if (text.includes(word)) return { intent: 'not_interested', confidence: 0.9 };
  }
  
  // Check for age/gender info
  const ageGender = parseAgeGender(message);
  if (ageGender.youngestAge) {
    return { intent: 'gave_age_gender', confidence: 0.95, data: ageGender };
  }
  
  // Check for wants quote / interested
  const wantsQuoteWords = ['yes', 'yeah', 'yea', 'sure', 'ok', 'okay', 'interested', 'info', 'quote', 'price', 'cost', 'how much', 'tell me more', 'more info', 'sounds good', 'let\'s do it', 'sign me up', 'help me', 'need insurance', 'need coverage', 'want to know', 'fine', 'go ahead'];
  for (const word of wantsQuoteWords) {
    if (text.includes(word)) return { intent: 'wants_quote', confidence: 0.85 };
  }
  
  // Check for call me later
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const laterWords = ['later', 'next week', 'next month', 'few weeks', 'few days', 'busy', 'not right now', 'call me', 'text me', 'reach out', 'contact me'];
  
  for (const month of months) {
    if (text.includes(month)) {
      return { intent: 'call_later', confidence: 0.9, followUpDate: month };
    }
  }
  for (const word of laterWords) {
    if (text.includes(word)) return { intent: 'call_later', confidence: 0.8 };
  }
  
  // Check for questions
  if (text.includes('?') || text.includes('what') || text.includes('how') || text.includes('does it') || text.includes('cover')) {
    return { intent: 'has_question', confidence: 0.7 };
  }
  
  return { intent: 'unclear', confidence: 0.3 };
}

// Generate messages
const MESSAGES = {
  ageGender: "Alright, may I have the age and gender of everyone who will be insured?",
  quote: (low, high) => `Assuming you have no major chronic/critical conditions, you can qualify for plans between $${low}-$${high}/month. Deductibles and networks are customizable ➡️ with $50 copays for primary care, specialists, and urgent care; $250 for ER; $250 for outpatient surgeries; and $500 for inpatient stays. Maximum out of pocket 5k. Plans include free ACA-compliant preventive care (immunizations, physicals, mammograms, Pap smears, colonoscopies).`
};

// Webhook endpoint - receives from SalesGod
app.post('/webhook/salesgod', (req, res) => {
  console.log('Received webhook:', req.body);
  
  const { phone, full_name, first_name, last_name, messages_as_string, messages, status, created_at } = req.body;
  
  const name = full_name || `${first_name || ''} ${last_name || ''}`.trim() || 'Unknown';
  const messageText = messages_as_string || messages || '';
  
  // Get the last message (most recent)
  const messageLines = messageText.split('\n').filter(m => m.trim());
  const lastMessage = messageLines[messageLines.length - 1] || messageText;
  
  // Detect intent
  const intentResult = detectIntent(lastMessage);
  
  let category, priority, suggestedAction, copyMessage, tagToApply, followUpDate;
  
  switch (intentResult.intent) {
    case 'wants_quote':
      category = 'wants_quote';
      priority = 'high';
      suggestedAction = 'Send age/gender message';
      copyMessage = MESSAGES.ageGender;
      tagToApply = 'Age and gender';
      break;
      
    case 'gave_age_gender':
      const { adults, kids, youngestAge } = intentResult.data;
      const quote = calculateQuote(adults, kids, youngestAge);
      category = 'ready_for_quote';
      priority = 'high';
      suggestedAction = `Send quote: ${adults} adult(s), ${kids} kid(s), age bracket ${quote.bracket}`;
      copyMessage = MESSAGES.quote(quote.lowPrice, quote.highPrice);
      tagToApply = 'Quoted';
      break;
      
    case 'not_interested':
      category = 'dead';
      priority = 'low';
      suggestedAction = 'Remove from campaigns';
      copyMessage = null;
      tagToApply = null;
      break;
      
    case 'call_later':
      category = 'scheduled';
      priority = 'medium';
      followUpDate = intentResult.followUpDate || 'Next month';
      suggestedAction = `Schedule follow-up for ${followUpDate}`;
      copyMessage = null;
      tagToApply = 'Follow up';
      break;
      
    case 'has_question':
      category = 'question';
      priority = 'medium';
      suggestedAction = 'Answer their question';
      copyMessage = null;
      tagToApply = null;
      break;
      
    default:
      category = 'review';
      priority = 'low';
      suggestedAction = 'Review manually';
      copyMessage = null;
      tagToApply = null;
  }
  
  const lead = {
    id: Date.now(),
    phone,
    name,
    lastMessage,
    fullConversation: messageText,
    timestamp: new Date().toISOString(),
    category,
    priority,
    suggestedAction,
    copyMessage,
    tagToApply,
    followUpDate,
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    status: 'new',
    notes: [],
    actions: []
  };
  
  leads.unshift(lead);
  if (leads.length > 500) leads = leads.slice(0, 500);
  
  console.log('Processed lead:', lead);
  res.json({ success: true, lead });
});

// API endpoints for dashboard
app.get('/api/leads', (req, res) => {
  res.json(leads);
});

app.post('/api/leads/:id/action', (req, res) => {
  const { id } = req.params;
  const { action } = req.body;
  const lead = leads.find(l => l.id === parseInt(id));
  if (lead) {
    lead.actions.push({ action, timestamp: new Date().toISOString() });
    lead.status = 'handled';
  }
  res.json({ success: true });
});

app.post('/api/leads/:id/note', (req, res) => {
  const { id } = req.params;
  const { note } = req.body;
  const lead = leads.find(l => l.id === parseInt(id));
  if (lead) {
    lead.notes.push({ text: note, timestamp: new Date().toISOString() });
  }
  res.json({ success: true });
});

app.post('/api/leads/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, category } = req.body;
  const lead = leads.find(l => l.id === parseInt(id));
  if (lead) {
    if (status) lead.status = status;
    if (category) lead.category = category;
  }
  res.json({ success: true });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ status: 'AI Lead System Running', leads: leads.length });
});

// Simulate incoming lead (for testing)
app.post('/api/simulate', (req, res) => {
  const testMessages = [
    { msg: "Yes I'm interested!", intent: "wants_quote" },
    { msg: "I'm 35 male, wife is 32, 2 kids", intent: "gave_age_gender" },
    { msg: "Can you call me in April?", intent: "call_later" },
    { msg: "Not interested, already have coverage", intent: "not_interested" },
    { msg: "How much does this cost?", intent: "has_question" }
  ];
  
  const test = testMessages[Math.floor(Math.random() * testMessages.length)];
  
  req.body = {
    phone: `(555) ${Math.floor(Math.random()*900+100)}-${Math.floor(Math.random()*9000+1000)}`,
    full_name: `Test Lead ${Date.now()}`,
    messages_as_string: test.msg
  };
  
  // Process like normal webhook
  app.handle(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Lead System running on port ${PORT}`);
});
