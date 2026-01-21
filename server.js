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
  
  // SINGLE AGE - if they just text a number 18-64, that's their age for a quote
  const singleAgeMatch = text.match(/^(\d{1,2})$/);
  if (singleAgeMatch) {
    const age = parseInt(singleAgeMatch[1]);
    if (age >= 18 && age <= 64) {
      return { 
        intent: 'gave_age_gender', 
        confidence: 0.95, 
        data: { adults: 1, kids: 0, youngestAge: age, ages: [age], hasMedicareAge: false }
      };
    }
    if (age >= 65) {
      return { intent: 'medicare', confidence: 0.95, data: { ages: [age], hasMedicareAge: true } };
    }
  }
  
  // SINGLE AGE WITH GENDER - "42 m", "42 male", "42 f", "35 female"
  const ageGenderMatch = text.match(/^(\d{1,2})\s*(m|f|male|female|man|woman)$/i);
  if (ageGenderMatch) {
    const age = parseInt(ageGenderMatch[1]);
    if (age >= 18 && age <= 64) {
      return { 
        intent: 'gave_age_gender', 
        confidence: 0.95, 
        data: { adults: 1, kids: 0, youngestAge: age, ages: [age], hasMedicareAge: false }
      };
    }
    if (age >= 65) {
      return { intent: 'medicare', confidence: 0.95, data: { ages: [age], hasMedicareAge: true } };
    }
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

// ============ MESSAGE TEMPLATES ============
const MESSAGES = {
  ageGender: "Hey! I just need your age for the quote.",
  quote: (low, high) => `Assuming you have no major chronic/critical conditions, you can qualify for plans between $${low}-$${high}/month. Deductibles and networks are customizable ➡️ with $50 copays for primary care, specialists, and urgent care; $250 for ER; $250 for outpatient surgeries; and $500 for inpatient stays. Maximum out of pocket 5k. Plans include free ACA-compliant preventive care (immunizations, physicals, mammograms, Pap smears, colonoscopies).`,
  medicare: `We don't specialize in Medicare, but here is our referral. Her name is Faith, she's been doing this for over a decade. Text her here +1 (352) 900-3966 or get on her calendar. PLEASE mention Jack referred you! https://api.leadconnectorhq.com/widget/bookings/faithinsurancesolcalendar`
};

function processMessage(message, context = {}) {
  const intentResult = detectIntent(message);
  const { currentTag, quoteSent, referralSent, messageHistory } = context;
  
  // Determine conversation stage
  const isQuoted = currentTag === 'Quoted' || quoteSent;
  const isMedicareReferred = currentTag === 'Medicare Referral' || referralSent;
  
  let category, priority, suggestedAction, copyMessage, tagToApply, followUpDate;
  
  switch (intentResult.intent) {
    case 'wants_quote':
      if (isQuoted) {
        // Already quoted - they might have questions or want to proceed
        category = 'question';
        priority = 'high';
        suggestedAction = '💬 Already quoted - may have questions or ready to book';
        copyMessage = "Happy to go over the numbers! Any questions, or ready to get started?";
      } else {
        category = 'wants_quote';
        priority = 'high';
        suggestedAction = '🔥 HOT LEAD - Need age for quote';
        copyMessage = "Hey! I just need your age for the quote.";
        tagToApply = 'Age and gender';
      }
      break;
      
    case 'gave_age_gender':
      if (isQuoted) {
        // Already quoted but giving age again? Maybe for family member
        category = 'question';
        priority = 'high';
        suggestedAction = '💬 Already quoted - may be adding family member';
        copyMessage = "Want me to update the quote to include them?";
      } else {
        const { adults, kids, youngestAge, ages } = intentResult.data;
        const quote = calculateQuote(adults, kids, youngestAge);
        category = 'ready_for_quote';
        priority = 'high';
        suggestedAction = `💰 SEND QUOTE: ${adults} adult(s), ${kids} kid(s), ages: ${ages.join(', ')}, bracket ${quote.bracket}`;
        copyMessage = MESSAGES.quote(quote.lowPrice, quote.highPrice);
        tagToApply = 'Quoted';
      }
      break;
      
    case 'medicare':
      if (isMedicareReferred) {
        category = 'review';
        priority = 'low';
        suggestedAction = '👴 Already sent Medicare referral';
        copyMessage = "Did you get a chance to reach out to Faith? She's great with Medicare!";
      } else {
        category = 'medicare';
        priority = 'medium';
        suggestedAction = '👴 Medicare lead - send Faith referral';
        copyMessage = MESSAGES.medicare;
        tagToApply = 'Medicare Referral';
      }
      break;
      
    case 'not_interested':
      category = 'dead';
      priority = 'low';
      suggestedAction = '❌ Not interested - no action needed';
      copyMessage = null;
      tagToApply = 'Dead';
      break;
      
    case 'call_later':
      category = 'scheduled';
      priority = 'medium';
      followUpDate = intentResult.followUpDate || 'later';
      suggestedAction = `📅 Follow up: ${followUpDate}`;
      copyMessage = `Sounds good, I'll follow up ${followUpDate}!`;
      tagToApply = 'Follow up';
      break;
      
    case 'has_question':
      category = 'question';
      priority = 'high';
      if (isQuoted) {
        suggestedAction = '❓ Question about quote - answer and close';
        copyMessage = "Happy to answer! What's your question?";
      } else {
        suggestedAction = '❓ Has question - answer then get age';
        copyMessage = "Happy to help! What's your age? I'll get you numbers and answer any questions.";
      }
      break;
      
    case 'greeting':
      if (isQuoted) {
        category = 'soft_positive';
        priority = 'high';
        suggestedAction = '👋 Greeting after quote - push for booking';
        copyMessage = "Hey! Did you get a chance to look at those numbers? Any questions?";
      } else {
        category = 'soft_positive';
        priority = 'medium';
        suggestedAction = '👋 Greeting - ask for age';
        copyMessage = "Hey! I just need your age for the quote.";
        tagToApply = 'Age and gender';
      }
      break;
      
    case 'soft_positive':
      if (isQuoted) {
        category = 'soft_positive';
        priority = 'high';
        suggestedAction = '🤔 Interested after quote - push for booking';
        copyMessage = "Great! When works for a quick 10-min call to get you set up?";
      } else {
        category = 'soft_positive';
        priority = 'medium';
        suggestedAction = '🤔 Interested - ask for age';
        copyMessage = "Hey! I just need your age for the quote.";
        tagToApply = 'Age and gender';
      }
      break;
      
    default:
      if (isQuoted) {
        category = 'review';
        priority = 'medium';
        suggestedAction = '👀 Review - already quoted';
        copyMessage = "Any questions on those numbers? Happy to go over the details!";
      } else {
        category = 'review';
        priority = 'medium';
        suggestedAction = '👀 Review - need age';
        copyMessage = "Hey! I just need your age for the quote.";
      }
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

// ============ AI REFINE ENDPOINT ============
app.post('/api/ai/refine', async (req, res) => {
  const { phone, currentSuggestion, leadMessage, instruction, context } = req.body;
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: `You are helping a health insurance agent refine their text message responses. 
Keep responses SHORT (1-2 sentences max). 
The agent sells private health insurance for ages 18-64.
For ages 65+, they refer to Faith for Medicare.
To give a quote they need the lead's age.
Be conversational, friendly, not salesy.`,
      messages: [
        {
          role: 'user',
          content: `Current suggested response: "${currentSuggestion}"

Lead's last message: "${leadMessage}"

Lead context: ${context.name || 'Unknown'}, Tag: ${context.tag || 'None'}, Category: ${context.category || 'unknown'}

The agent wants you to modify the response with this instruction: "${instruction}"

Write ONLY the new response text, nothing else. Keep it short (1-2 sentences).`
        }
      ]
    });
    
    const newResponse = response.content[0].text.trim();
    
    // Save the refinement for learning
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    const lead = await getLead(cleanPhone);
    if (lead) {
      if (!lead.refinements) lead.refinements = [];
      lead.refinements.push({
        instruction,
        before: currentSuggestion,
        after: newResponse,
        timestamp: new Date().toISOString()
      });
      lead.copyMessage = newResponse;
      await saveLead(cleanPhone, lead);
    }
    
    res.json({ success: true, newResponse });
  } catch (err) {
    console.error('AI refine error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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
      
      if (isOutgoing) {
        // OUTGOING MESSAGE - We sent something, clear suggestions
        lead.category = 'waiting';
        lead.priority = 'low';
        lead.suggestedAction = '⏳ Waiting for response';
        lead.copyMessage = null;
        lead.tagToApply = null;
        
        // Track what we sent
        const msgLower = messages_as_string.toLowerCase();
        if (msgLower.includes('qualify for plans between') || msgLower.includes('deductibles and networks')) {
          lead.quoteSent = true;
          lead.quoteSentAt = new Date().toISOString();
        }
        if (msgLower.includes('faith') && (msgLower.includes('medicare') || msgLower.includes('352'))) {
          lead.referralSent = true;
        }
        
      } else {
        // INCOMING MESSAGE - Analyze and suggest response
        analysis = processMessage(messages_as_string, { 
          currentTag: lead.currentTag,
          quoteSent: lead.quoteSent,
          referralSent: lead.referralSent,
          messageHistory: lead.messages
        });
        lead.category = analysis.category;
        lead.priority = analysis.priority;
        lead.suggestedAction = analysis.suggestedAction;
        lead.copyMessage = analysis.copyMessage;
        lead.tagToApply = analysis.tagToApply;
        lead.parsedData = analysis.parsedData;
        
        if (analysis.followUpDate) {
          lead.followUpDate = analysis.followUpDate;
        }
        
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
  const analysis = processMessage(test.msg);
  
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

// ============ AUTO-SEND SETTINGS ============
let autoSendEnabled = false;

app.get('/api/settings/auto-send', (req, res) => {
  res.json({ enabled: autoSendEnabled });
});

app.post('/api/settings/auto-send', (req, res) => {
  autoSendEnabled = req.body.enabled === true;
  console.log('Auto-send:', autoSendEnabled ? 'ON' : 'OFF');
  res.json({ enabled: autoSendEnabled });
});

// ============ PENDING MESSAGES FOR AUTO-SEND ============
app.get('/api/leads/:phone/pending', async (req, res) => {
  // Only return pending if auto-send is enabled
  if (!autoSendEnabled) {
    return res.json({ pending: false, reason: 'auto-send disabled' });
  }
  
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

// ============ ANALYTICS ENDPOINT ============
app.get('/api/analytics', async (req, res) => {
  try {
    const leads = await getAllLeads();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Basic counts
    const totalLeads = leads.length;
    const activeLeads = leads.filter(l => l.status !== 'handled').length;
    const handledLeads = leads.filter(l => l.status === 'handled').length;

    // Category breakdown
    const byCategory = {
      hot: leads.filter(l => l.category === 'wants_quote').length,
      quoted: leads.filter(l => l.category === 'ready_for_quote' || l.quoteSent).length,
      scheduled: leads.filter(l => l.category === 'scheduled').length,
      dead: leads.filter(l => l.category === 'dead').length,
      medicare: leads.filter(l => l.category === 'medicare' || l.isMedicare).length,
      soft: leads.filter(l => l.category === 'soft_positive').length,
      question: leads.filter(l => l.category === 'question').length
    };

    // Conversion metrics
    const quotedLeads = leads.filter(l => l.quoteSent);
    const bookedLeads = leads.filter(l => l.actions?.some(a => a.action === 'Booked'));
    const quoteToBook = quotedLeads.length > 0 ?
      Math.round((bookedLeads.length / quotedLeads.length) * 100) : 0;

    // Time-based metrics
    const leadsToday = leads.filter(l => new Date(l.createdAt) >= today).length;
    const leadsThisWeek = leads.filter(l => new Date(l.createdAt) >= thisWeek).length;
    const leadsThisMonth = leads.filter(l => new Date(l.createdAt) >= thisMonth).length;

    // Response time (avg time from lead creation to first action)
    const leadsWithActions = leads.filter(l => l.actions?.length > 0 && l.createdAt);
    let avgResponseTime = 0;
    if (leadsWithActions.length > 0) {
      const totalTime = leadsWithActions.reduce((sum, l) => {
        const created = new Date(l.createdAt).getTime();
        const firstAction = new Date(l.actions[0].timestamp).getTime();
        return sum + (firstAction - created);
      }, 0);
      avgResponseTime = Math.round(totalTime / leadsWithActions.length / 1000 / 60); // minutes
    }

    // Follow-up tracking
    const needsFollowUp = leads.filter(l =>
      l.category === 'scheduled' &&
      l.status !== 'handled' &&
      l.followUpDate
    ).length;

    // Actions breakdown
    const actionCounts = {};
    leads.forEach(l => {
      (l.actions || []).forEach(a => {
        actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
      });
    });

    res.json({
      totalLeads,
      activeLeads,
      handledLeads,
      byCategory,
      conversions: {
        quoted: quotedLeads.length,
        booked: bookedLeads.length,
        quoteToBookRate: quoteToBook
      },
      timeMetrics: {
        today: leadsToday,
        thisWeek: leadsThisWeek,
        thisMonth: leadsThisMonth,
        avgResponseMinutes: avgResponseTime
      },
      needsFollowUp,
      actionCounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ FOLLOW-UP REMINDERS ============
app.get('/api/followups', async (req, res) => {
  try {
    const leads = await getAllLeads();
    const now = new Date();

    const followUps = leads.filter(l =>
      l.status !== 'handled' &&
      (l.category === 'scheduled' || l.followUpDate)
    ).map(l => ({
      phone: l.phone,
      name: l.name,
      followUpDate: l.followUpDate,
      lastMessageAt: l.lastMessageAt,
      category: l.category,
      daysSinceContact: Math.floor((now - new Date(l.lastMessageAt)) / (1000 * 60 * 60 * 24))
    })).sort((a, b) => a.daysSinceContact - b.daysSinceContact);

    // Also get "stale" leads - no contact in 3+ days
    const staleLeads = leads.filter(l => {
      if (l.status === 'handled' || l.category === 'dead') return false;
      const lastContact = new Date(l.lastMessageAt || l.createdAt);
      const daysSince = (now - lastContact) / (1000 * 60 * 60 * 24);
      return daysSince >= 3;
    }).map(l => ({
      phone: l.phone,
      name: l.name,
      lastMessageAt: l.lastMessageAt,
      category: l.category,
      daysSinceContact: Math.floor((now - new Date(l.lastMessageAt || l.createdAt)) / (1000 * 60 * 60 * 24))
    }));

    res.json({ followUps, staleLeads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ CALL TRACKING ============
app.post('/api/leads/:phone/call', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  const { outcome, duration, notes, scheduled } = req.body;

  try {
    const lead = await getLead(phone);
    if (lead) {
      if (!lead.calls) lead.calls = [];
      lead.calls.push({
        outcome, // 'answered', 'voicemail', 'no_answer', 'busy', 'scheduled'
        duration, // in seconds
        notes,
        scheduled, // if scheduling a callback
        timestamp: new Date().toISOString()
      });

      // Update lead status based on outcome
      if (outcome === 'answered' || outcome === 'scheduled') {
        lead.lastCallOutcome = outcome;
        if (scheduled) {
          lead.followUpDate = scheduled;
          lead.category = 'scheduled';
        }
      }

      await saveLead(phone, lead);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'Lead not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ CALENDLY SETTINGS ============
let calendlySettings = {
  url: process.env.CALENDLY_URL || '',
  eventType: 'health-insurance-consultation'
};

app.get('/api/settings/calendly', (req, res) => {
  res.json(calendlySettings);
});

app.post('/api/settings/calendly', (req, res) => {
  if (req.body.url) calendlySettings.url = req.body.url;
  if (req.body.eventType) calendlySettings.eventType = req.body.eventType;
  res.json(calendlySettings);
});

// ============ SCHEDULE APPOINTMENT (for lead) ============
app.post('/api/leads/:phone/schedule', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  const { scheduledTime, notes } = req.body;

  try {
    const lead = await getLead(phone);
    if (lead) {
      lead.scheduledAppointment = {
        time: scheduledTime,
        notes,
        createdAt: new Date().toISOString()
      };
      lead.category = 'scheduled';
      lead.followUpDate = new Date(scheduledTime).toLocaleDateString();

      if (!lead.actions) lead.actions = [];
      lead.actions.push({
        action: 'Scheduled appointment',
        timestamp: new Date().toISOString(),
        details: scheduledTime
      });

      await saveLead(phone, lead);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'Lead not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ ENHANCED QUOTE ENDPOINT ============
app.post('/api/quote', (req, res) => {
  const { adults, kids, youngestAge } = req.body;
  const quote = calculateQuote(adults || 1, kids || 0, youngestAge || 35);

  // Add plan details
  const plans = [
    {
      name: 'Bronze',
      price: quote.lowPrice,
      deductible: 7500,
      copay: { primary: 50, specialist: 75, urgent: 75, er: 350 },
      maxOutOfPocket: 8000
    },
    {
      name: 'Silver',
      price: Math.round((quote.lowPrice + quote.highPrice) / 2),
      deductible: 5000,
      copay: { primary: 50, specialist: 50, urgent: 50, er: 250 },
      maxOutOfPocket: 5000
    },
    {
      name: 'Gold',
      price: quote.highPrice,
      deductible: 2500,
      copay: { primary: 25, specialist: 40, urgent: 40, er: 200 },
      maxOutOfPocket: 3500
    }
  ];

  res.json({
    bracket: quote.bracket,
    adults,
    kids,
    youngestAge,
    plans,
    lowPrice: quote.lowPrice,
    highPrice: quote.highPrice
  });
});

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🇺🇸 Duddas CRM v4.0 on port ${PORT} - Making Insurance Great Again!`);
    console.log(`AI Responses: ${process.env.ANTHROPIC_API_KEY ? 'ENABLED' : 'DISABLED (set ANTHROPIC_API_KEY)'}`);
  });
});
