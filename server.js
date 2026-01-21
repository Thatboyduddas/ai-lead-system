const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Claude API client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        phone VARCHAR(50) PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('🇺🇸 Duddas CRM v3.0 Database initialized');
  } catch (err) {
    console.error('Database init error:', err);
  }
}

async function getLead(phone) {
  const result = await pool.query('SELECT data FROM leads WHERE phone = $1', [phone]);
  return result.rows[0]?.data || null;
}

async function saveLead(phone, data) {
  await pool.query(`
    INSERT INTO leads (phone, data, updated_at) 
    VALUES ($1, $2, NOW())
    ON CONFLICT (phone) 
    DO UPDATE SET data = $2, updated_at = NOW()
  `, [phone, JSON.stringify(data)]);
}

async function getAllLeads() {
  const result = await pool.query('SELECT data FROM leads ORDER BY updated_at DESC');
  return result.rows.map(row => row.data);
}

async function clearAllLeads() {
  await pool.query('DELETE FROM leads');
}

// ============ PRICING ============
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

function getAgeBracket(age) {
  if (age >= 18 && age <= 29) return '18-29';
  if (age >= 30 && age <= 44) return '30-44';
  if (age >= 45 && age <= 54) return '45-54';
  if (age >= 55 && age <= 64) return '55-64';
  return '30-44';
}

function calculateQuote(adults, kids, youngestAge) {
  const bracket = getAgeBracket(youngestAge);
  const low = PRICING.low[bracket];
  const high = PRICING.high[bracket];
  
  let lowPrice, highPrice;
  
  if (adults === 1 && kids === 0) {
    lowPrice = low.single; highPrice = high.single;
  } else if (adults === 2 && kids === 0) {
    lowPrice = low.spouse; highPrice = high.spouse;
  } else if (adults === 1 && kids === 1) {
    lowPrice = Math.round((low.single + low.kids) / 2);
    highPrice = Math.round((high.single + high.kids) / 2);
  } else if (adults === 1 && kids >= 2) {
    lowPrice = low.kids; highPrice = high.kids;
  } else if (adults === 2 && kids === 1) {
    lowPrice = Math.round((low.spouse + low.family) / 2);
    highPrice = Math.round((high.spouse + high.family) / 2);
  } else if (adults === 2 && kids >= 2) {
    lowPrice = low.family; highPrice = high.family;
  } else if (adults >= 3) {
    lowPrice = low.family; highPrice = high.family;
  } else {
    lowPrice = low.single; highPrice = high.single;
  }
  
  return { lowPrice, highPrice, bracket };
}

// ============ IMPROVED AGE/GENDER PARSING ============
function parseAgeGender(message) {
  const text = message.toLowerCase();
  const ages = [];
  let numKids = 0;
  
  const allMatches = message.match(/\b(\d{1,2})\b/g);
  if (allMatches) {
    allMatches.forEach(match => {
      const age = parseInt(match);
      if (age >= 18 && age <= 99) {
        ages.push(age);
      }
    });
  }
  
  const kidsMatch = text.match(/(\d+)\s*(kids?|children|child|dependents?)/i);
  if (kidsMatch) {
    numKids = parseInt(kidsMatch[1]) || 1;
  } else if (/\b(kid|child|dependent|son|daughter)\b/i.test(text)) {
    numKids = 1;
  }
  
  const wordNums = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const wordMatch = text.match(/(one|two|three|four|five)\s*(kids?|children)/i);
  if (wordMatch) {
    numKids = wordNums[wordMatch[1].toLowerCase()] || 1;
  }
  
  const hasSpouse = /wife|husband|spouse|partner|married|couple|and my|and her|and his/i.test(text);
  const justMe = /just\s*me|only\s*me|myself|single|just\s*myself|only myself/i.test(text);
  
  let adults = ages.length || 1;
  if (hasSpouse && adults < 2) adults = 2;
  if (justMe && ages.length <= 1) adults = 1;
  
  const adultAges = ages.filter(a => a >= 18 && a <= 64);
  const youngestAge = adultAges.length > 0 ? Math.min(...adultAges) : (ages[0] || 35);
  const hasMedicareAge = ages.some(a => a >= 65);
  
  return { adults, kids: numKids, youngestAge, ages, hasMedicareAge };
}

// ============ INTENT DETECTION ============
function detectIntent(message) {
  const text = message.toLowerCase().trim();
  
  // Check for FOLLOW-UP indicators FIRST (overrides stop words)
  // People who say "no thanks BUT..." or "im good BUT maybe later" are follow-ups, not dead
  const followUpIndicators = [
    'maybe', 'later', 'some time', 'sometime', 'get back', 'reach out', 
    'check back', 'next month', 'next week', 'after', 'when i', "when i'm",
    'once i', 'ill see', "i'll see", 'ill check', "i'll check", 'let me think', 
    'think about', 'consider', 'might be', 'could be', 'possibly', 'see what',
    'what you have', 'what you got', 'have time', 'get time', 'free time',
    'busy now', 'busy right now', 'right now', 'at the moment', 'for now'
  ];
  
  const hasFollowUpIntent = followUpIndicators.some(indicator => text.includes(indicator));
  
  // If ANY follow-up language exists, this is a follow-up lead, not dead
  if (hasFollowUpIntent) {
    return { intent: 'call_later', confidence: 0.85, followUpDate: 'when they have time' };
  }
  
  // HARD STOP WORDS (these are definite no's with no follow-up language)
  const hardStopWords = [
    'stop', 'unsubscribe', 'remove me', 'leave me alone', 'dont text', "don't text",
    'wrong number', 'lose my number', 'take me off', 'opted out', 'do not contact'
  ];
  for (const word of hardStopWords) {
    if (text.includes(word)) return { intent: 'not_interested', confidence: 0.95 };
  }
  
  // SOFT STOP WORDS - only count as dead if NO follow-up intent (already checked above)
  const softStopWords = [
    'not interested', 'no thanks', 'no thank', 'already have insurance', 
    'all good', 'all set', 'im good', "i'm good", 'pass', 'nope', 'nah',
    'too expensive', 'too pricey', 'cant afford', "can't afford", 'no money'
  ];
  
  // Pure soft stops without follow-up intent = dead
  for (const word of softStopWords) {
    if (text.includes(word)) return { intent: 'not_interested', confidence: 0.85 };
  }
  
  // MEDICARE detection
  const medicareWords = ['medicare', 'over 65', 'im 65', "i'm 65", 'turning 65'];
  for (const word of medicareWords) {
    if (text.includes(word)) return { intent: 'medicare', confidence: 0.9 };
  }
  
  const ageMatches = message.match(/\b(6[5-9]|[7-9][0-9])\b/g);
  if (ageMatches && ageMatches.length > 0) {
    const ageGender = parseAgeGender(message);
    return { intent: 'medicare', confidence: 0.9, data: ageGender };
  }
  
  // AGE/GENDER - check for age + gender indicators
  const hasAge = /\b(1[89]|[2-5][0-9]|6[0-4])\b/.test(text);
  const hasGender = /\b(male|female|m|f|man|woman|guy|girl)\b/i.test(text);
  const hasFamily = /wife|husband|spouse|partner|kid|child|just me|only me|myself/i.test(text);
  
  if (hasAge && (hasGender || hasFamily)) {
    const ageGender = parseAgeGender(message);
    return { intent: 'gave_age_gender', confidence: 0.95, data: ageGender };
  }
  
  const multipleAges = message.match(/\b(1[89]|[2-5][0-9]|6[0-4])\b/g);
  if (multipleAges && multipleAges.length >= 2) {
    const ageGender = parseAgeGender(message);
    return { intent: 'gave_age_gender', confidence: 0.9, data: ageGender };
  }
  
  if (hasAge) {
    if (/\b(m|f|male|female|man|woman)\b/i.test(text)) {
      const ageGender = parseAgeGender(message);
      return { intent: 'gave_age_gender', confidence: 0.85, data: ageGender };
    }
  }
  
  // POSITIVE / INTERESTED responses
  const positiveWords = [
    'yes', 'yeah', 'yea', 'yep', 'sure', 'ok', 'okay', 'interested', 'info',
    'quote', 'price', 'cost', 'how much', 'tell me more', 'sounds good',
    "let's do it", 'sign me up', 'need insurance', 'need coverage', 'fine',
    'go ahead', 'send it', 'want a quote', 'can you send', 'more info',
    'what do you have', 'what plans', 'help me', 'looking for', 'shopping for',
    'need health', 'want health', 'definitely', 'absolutely', 'for sure',
    'please', 'sounds great', 'im interested', "i'm interested",
    'i am interested', 'what do i need', 'what you got', 'whatcha got'
  ];
  for (const word of positiveWords) {
    if (text.includes(word)) return { intent: 'wants_quote', confidence: 0.85 };
  }
  
  // CALL LATER / SCHEDULE
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const laterWords = ['later', 'next week', 'next month', 'few weeks', 'busy right now', 'not right now', 'call me', 'text me later', 'get back to me', 'reach out', 'contact me', 'try again', 'maybe later', 'in a few', 'after the'];
  
  for (const month of months) {
    if (text.includes(month)) {
      return { intent: 'call_later', confidence: 0.9, followUpDate: month };
    }
  }
  for (const word of laterWords) {
    if (text.includes(word)) return { intent: 'call_later', confidence: 0.8 };
  }
  
  // QUESTIONS
  const questionIndicators = ['?', 'who is this', 'what company', 'what provider', 'which insurance', 'what insurance', 'how does', 'how do', 'what are', 'where are', 'when can', 'is this'];
  for (const q of questionIndicators) {
    if (text.includes(q)) return { intent: 'has_question', confidence: 0.7 };
  }
  
  // SOFT POSITIVES
  const softPositive = ['maybe', 'possibly', 'might', 'could be', 'depends', 'thinking', 'consider', 'let me', 'ill think', "i'll think", 'hmm', 'hm', 'idk', 'not sure yet'];
  for (const word of softPositive) {
    if (text.includes(word)) return { intent: 'soft_positive', confidence: 0.6 };
  }
  
  // Short greetings/responses - need AI to handle contextually
  if (text.length <= 15 && text.length > 0) {
    const shortPositive = ['hi', 'hello', 'hey', 'sup', 'yo', 'k', 'kk', 'cool', 'bet', 'aight', 'word', 'thanks', 'thank you', 'thx', 'ty'];
    for (const word of shortPositive) {
      if (text === word || text.startsWith(word + ' ') || text.startsWith(word + '!')) {
        return { intent: 'greeting', confidence: 0.5 };
      }
    }
  }
  
  // Default - needs review
  return { intent: 'review', confidence: 0.3 };
}

// ============ AI RESPONSE GENERATION ============
async function generateAIResponse(leadMessage, intent, context = {}) {
  const systemPrompt = `You are a friendly health insurance agent named Jack. You help people get quotes for private health insurance plans.

RULES:
- Keep responses SHORT (1-2 sentences max)
- Be conversational and friendly, not salesy
- Match the lead's energy/tone
- Your GOAL is always to get their age so you can provide a quote
- Never be pushy or aggressive
- Use casual language, contractions
- Sound human, not like a bot

IMPORTANT: If someone says "no thanks" or "not right now" but ALSO mentions "maybe later" or "when I have time" - they are NOT dead! They're soft follow-ups. Ask WHEN to follow up.

CONTEXT:
- You sell private health insurance for ages 18-64
- For ages 65+, you refer to Faith for Medicare
- To give a quote you need: age of everyone being insured
- Plans range $239-$1800/month depending on age and family size

WHAT YOU KNOW ABOUT THIS LEAD:
- Their message: "${leadMessage}"
- Detected intent: ${intent}
- Current tag: ${context.currentTag || 'new'}`;

  let userPrompt = '';
  
  switch (intent) {
    case 'greeting':
      userPrompt = `The lead just said "${leadMessage}" - this is a greeting/acknowledgment. They're responding to your outreach about health insurance. Write a friendly reply that acknowledges their greeting and naturally asks for their age to provide a quote. Don't be robotic - match their casual energy.`;
      break;
    case 'soft_positive':
      userPrompt = `The lead said "${leadMessage}" - they seem somewhat interested but non-committal. Write a low-pressure response that gently moves toward getting their age for a quote.`;
      break;
    case 'has_question':
      userPrompt = `The lead asked: "${leadMessage}". Answer their question briefly and professionally, then guide toward getting their age for a quote if appropriate.`;
      break;
    case 'wants_quote':
      userPrompt = `The lead said "${leadMessage}" - they want a quote! Ask for the age (and gender if needed) of everyone who will be on the plan. Keep it simple.`;
      break;
    case 'call_later':
      userPrompt = `The lead said "${leadMessage}" - they're not ready right now but left the door open for later. They might have said something like "maybe later" or "when I have time" or "not right now but...". Write a friendly, understanding response that:
1. Acknowledges their timing without being pushy (like "totally understand" or "no problem")
2. Asks when specifically would be a good time to reach back out
Keep it warm and human.`;
      break;
    default:
      userPrompt = `The lead said "${leadMessage}". Write an appropriate response that moves the conversation toward getting their age for a quote, or addresses whatever they said.`;
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      system: systemPrompt
    });
    
    return response.content[0].text.trim();
  } catch (err) {
    console.error('AI generation error:', err);
    // Fallback to template if AI fails
    return null;
  }
}

// ============ MESSAGE TEMPLATES (FALLBACKS) ============
const MESSAGES = {
  ageGender: "Alright, what is the age and gender of everyone that will be insured?",
  quote: (low, high) => `Assuming you have no major chronic/critical conditions, you can qualify for plans between $${low}-$${high}/month. Deductibles and networks are customizable ➡️ with $50 copays for primary care, specialists, and urgent care; $250 for ER; $250 for outpatient surgeries; and $500 for inpatient stays. Maximum out of pocket 5k. Plans include free ACA-compliant preventive care (immunizations, physicals, mammograms, Pap smears, colonoscopies).`,
  medicare: `We don't specialize in Medicare, but here is our referral for Medicare. Her name is Faith, she has been doing this for over a decade. Text her here +1 (352) 900-3966 or get on her calendar for a consultation. PLEASE make sure to mention Jack referred you! https://api.leadconnectorhq.com/widget/bookings/faithinsurancesolcalendar`
};

async function processMessage(message, context = {}) {
  const intentResult = detectIntent(message);
  
  let category, priority, suggestedAction, copyMessage, tagToApply, followUpDate;
  
  switch (intentResult.intent) {
    case 'wants_quote':
      category = 'wants_quote';
      priority = 'high';
      suggestedAction = '🔥 HOT LEAD! Send age/gender question';
      // Use AI for contextual response
      copyMessage = await generateAIResponse(message, 'wants_quote', context) || MESSAGES.ageGender;
      tagToApply = 'Age and gender';
      break;
      
    case 'gave_age_gender':
      const { adults, kids, youngestAge, ages } = intentResult.data;
      const quote = calculateQuote(adults, kids, youngestAge);
      category = 'ready_for_quote';
      priority = 'high';
      suggestedAction = `💰 SEND QUOTE: ${adults} adult(s), ${kids} kid(s), ages: ${ages.join(', ')}, bracket ${quote.bracket}`;
      copyMessage = MESSAGES.quote(quote.lowPrice, quote.highPrice);
      tagToApply = 'Quoted';
      break;
      
    case 'medicare':
      category = 'medicare';
      priority = 'medium';
      suggestedAction = '👴 Medicare lead - send Faith referral';
      copyMessage = MESSAGES.medicare;
      tagToApply = 'Medicare Referral';
      break;
      
    case 'not_interested':
      category = 'dead';
      priority = 'low';
      suggestedAction = '❌ Not interested - no action needed';
      tagToApply = 'Dead';
      break;
      
    case 'call_later':
      category = 'scheduled';
      priority = 'medium';
      followUpDate = intentResult.followUpDate || 'Later';
      suggestedAction = `📅 Follow up: ${followUpDate}`;
      copyMessage = await generateAIResponse(message, 'call_later', context) || `Got it, I'll follow up with you ${followUpDate}. Talk soon!`;
      tagToApply = 'Follow up';
      break;
      
    case 'has_question':
      category = 'question';
      priority = 'high';
      suggestedAction = '❓ Has a question - AI generated response';
      copyMessage = await generateAIResponse(message, 'has_question', context);
      break;
      
    case 'greeting':
      category = 'soft_positive';
      priority = 'medium';
      suggestedAction = '👋 Greeting - send friendly response with age question';
      copyMessage = await generateAIResponse(message, 'greeting', context) || "Hey there! For the health insurance quote, I just need your age - what've you got?";
      tagToApply = 'Age and gender';
      break;
      
    case 'soft_positive':
      category = 'soft_positive';
      priority = 'medium';
      suggestedAction = '🤔 Might be interested - send personalized response';
      copyMessage = await generateAIResponse(message, 'soft_positive', context) || MESSAGES.ageGender;
      tagToApply = 'Age and gender';
      break;
      
    default:
      category = 'review';
      priority = 'medium';
      suggestedAction = '👀 REVIEW - AI generated response';
      copyMessage = await generateAIResponse(message, 'review', context);
  }
  
  return { 
    category, 
    priority, 
    suggestedAction, 
    copyMessage, 
    tagToApply, 
    followUpDate, 
    intent: intentResult.intent, 
    confidence: intentResult.confidence,
    parsedData: intentResult.data || null
  };
}

// ============ WEBHOOK ============
app.post('/webhook/salesgod', async (req, res) => {
  console.log('Webhook received:', req.body);
  
  const { phone, full_name, messages_as_string, status, isOutgoing, hasReferral } = req.body;
  
  if (!phone) {
    return res.json({ success: false, error: 'No phone number' });
  }
  
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  
  try {
    let lead = await getLead(cleanPhone);
    
    if (!lead) {
      lead = {
        id: Date.now(),
        phone: phone,
        name: full_name || 'Unknown',
        messages: [],
        currentTag: status || '',
        status: 'active',
        notes: [],
        actions: [],
        createdAt: new Date().toISOString(),
        hasReferral: false
      };
    }
    
    if (full_name && full_name !== 'Unknown') {
      lead.name = full_name;
    }
    
    if (hasReferral) {
      lead.hasReferral = true;
    }
    
    const lastMsg = lead.messages[lead.messages.length - 1];
    if (!lastMsg || lastMsg.text !== messages_as_string || lastMsg.isOutgoing !== !!isOutgoing) {
      
      let analysis = null;
      if (!isOutgoing) {
        // Pass context to processMessage for better AI responses
        analysis = await processMessage(messages_as_string, { currentTag: lead.currentTag });
        lead.category = analysis.category;
        lead.priority = analysis.priority;
        lead.suggestedAction = analysis.suggestedAction;
        lead.copyMessage = analysis.copyMessage;
        lead.tagToApply = analysis.tagToApply;
        lead.parsedData = analysis.parsedData;
        
        if (analysis.intent === 'medicare') {
          lead.isMedicare = true;
        }
      }
      
      lead.messages.push({
        text: messages_as_string,
        timestamp: new Date().toISOString(),
        isOutgoing: !!isOutgoing,
        analysis: analysis
      });
      
      lead.lastMessageAt = new Date().toISOString();
    }
    
    if (status) {
      lead.currentTag = status;
    }
    
    await saveLead(cleanPhone, lead);
    res.json({ success: true, lead });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ API ROUTES ============
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await getAllLeads();
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/:phone/action', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  const { action } = req.body;
  
  try {
    const lead = await getLead(phone);
    if (lead) {
      lead.actions.push({ action, timestamp: new Date().toISOString() });
      lead.status = 'handled';
      await saveLead(phone, lead);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/:phone/note', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  const { note } = req.body;
  
  try {
    const lead = await getLead(phone);
    if (lead) {
      lead.notes.push({ text: note, timestamp: new Date().toISOString() });
      await saveLead(phone, lead);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/:phone/status', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  const { status, category } = req.body;
  
  try {
    const lead = await getLead(phone);
    if (lead) {
      if (status) lead.status = status;
      if (category) lead.category = category;
      await saveLead(phone, lead);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/test', async (req, res) => {
  try {
    const leads = await getAllLeads();
    res.json({ 
      status: '🇺🇸 Duddas CRM v3.0 - MAGA Edition', 
      leads: leads.length,
      message: 'Making Insurance Great Again!',
      aiEnabled: !!process.env.ANTHROPIC_API_KEY
    });
  } catch (err) {
    res.json({ status: 'Running (DB Error)', error: err.message });
  }
});

app.post('/api/simulate', async (req, res) => {
  const testMessages = [
    { msg: "Yes I'm interested!", name: "Hot Lead" },
    { msg: "55 female\n56 male\n32 female", name: "Family Quote" },
    { msg: "Can you call me in April?", name: "Schedule" },
    { msg: "How much?", name: "Price Ask" },
    { msg: "No thanks", name: "Dead" },
    { msg: "I'm 67 need coverage", name: "Medicare" },
    { msg: "Maybe", name: "Soft Positive" },
    { msg: "35 male just me", name: "Single" },
    { msg: "Hi", name: "Greeting" },
    { msg: "Hey", name: "Greeting 2" }
  ];
  
  const test = testMessages[Math.floor(Math.random() * testMessages.length)];
  const phone = `+1555${Math.floor(Math.random()*9000000+1000000)}`;
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const analysis = await processMessage(test.msg);
  
  const lead = {
    id: Date.now(),
    phone: phone,
    name: test.name,
    messages: [{ text: test.msg, timestamp: new Date().toISOString(), isOutgoing: false, analysis }],
    category: analysis.category,
    priority: analysis.priority,
    suggestedAction: analysis.suggestedAction,
    copyMessage: analysis.copyMessage,
    tagToApply: analysis.tagToApply,
    parsedData: analysis.parsedData,
    status: 'active',
    notes: [],
    actions: [],
    createdAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString()
  };
  
  try {
    await saveLead(cleanPhone, lead);
    res.json({ success: true, lead });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/clear', async (req, res) => {
  try {
    await clearAllLeads();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ PENDING MESSAGES FOR AUTO-SEND ============
app.get('/api/leads/:phone/pending', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  
  try {
    const lead = await getLead(phone);
    if (lead && lead.pendingMessage) {
      res.json({ pending: true, message: lead.pendingMessage });
    } else {
      res.json({ pending: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leads/:phone/pending', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  const { message } = req.body;
  
  try {
    const lead = await getLead(phone);
    if (lead) {
      lead.pendingMessage = message;
      await saveLead(phone, lead);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'Lead not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/leads/:phone/pending', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  
  try {
    const lead = await getLead(phone);
    if (lead) {
      delete lead.pendingMessage;
      await saveLead(phone, lead);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'Lead not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🇺🇸 Duddas CRM v3.0 on port ${PORT} - Making Insurance Great Again!`);
    console.log(`AI Responses: ${process.env.ANTHROPIC_API_KEY ? 'ENABLED' : 'DISABLED (set ANTHROPIC_API_KEY)'}`);
  });
});
