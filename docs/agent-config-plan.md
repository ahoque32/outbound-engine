# Agent Configuration Plan — Final

## 1. Agent Configuration Matrix

| ID | Agent | Voice | Personality | LLM | Latency | Cost/min |
|----|-------|-------|-------------|-----|---------|----------|
| `ava-warm` | Ava Warm (control) | Hope ♀ | Warm & Consultative | Gemini 2.5 Flash | ~890ms | $0.0018 |
| `ava-direct` | Ava Direct | Hope ♀ | Direct & Confident | Gemini 2.5 Flash | ~890ms | $0.0018 |
| `ava-warm-flirty` | Ava Flirty | Hope ♀ | Playfully Confident | Gemini 2.5 Flash | ~890ms | $0.0018 |
| `chris-charming` | Chris Charming | Chris ♂ | Charming & Down-to-Earth | GPT-4o Mini | ~650ms | $0.0018 |
| `eric-authority` | Eric Authority | Eric ♂ | Smooth & Authoritative | Qwen3-30B-A3B | ~211ms | $0.0041 |

## 2. Personality Definitions

### Ava Warm (Control)
- **Tone:** Friendly, curious, empathetic
- **Approach:** Asks about their challenges before presenting solutions
- **Phrases:** "I totally get that," "that makes a lot of sense"
- **Energy:** Helpful friend who's great at tech
- **Temperature:** 0.5

### Ava Direct
- **Tone:** Confident, efficient, results-focused
- **Approach:** Value prop within 10 seconds, respects their time
- **Phrases:** Short punchy sentences, no filler words
- **Energy:** Sharp business consultant who cuts through noise
- **Temperature:** 0.3

### Ava Warm Flirty
- **Tone:** Playful, magnetic, emotionally engaging
- **Approach:** Creates curiosity, uses light humor and gentle teasing
- **Phrases:** "I bet your competitors wish they had your customer base," "I noticed something about your website most people miss..."
- **Energy:** Most interesting sales call they've ever gotten — people say yes because they like talking to her
- **Temperature:** 0.6
- **Guardrails:** Remains professional, no inappropriate content, playful ≠ unprofessional

### Chris Charming
- **Tone:** Relatable, genuine, casual
- **Approach:** Sounds like a helpful neighbor, shares micro-stories
- **Phrases:** "Honestly," "real talk," "here's the thing"
- **Energy:** Person everyone likes at a party
- **Temperature:** 0.5

### Eric Authority
- **Tone:** Smooth, commanding, credible
- **Approach:** Leads with social proof and expertise
- **Phrases:** "Here's what I'd recommend," "The businesses that grow fastest do X"
- **Energy:** Trusted consultant who's seen it all
- **Temperature:** 0.4

## 3. Knowledge Injection Summary

All 5 agents share identical knowledge base injected into their system prompts:

### Services Embedded:
1. **Website Design & Revamps** — modern, mobile-first, conversion-optimized
2. **AI Voice Agents** (inbound & outbound) — 24/7 call handling, lead qualification, appointment booking
3. **AI Receptionist Systems** — virtual front desk, scheduling, FAQs, SMS/phone/web
4. **SaaS Development** — custom web apps, dashboards, client portals
5. **Workflow Automation** — automate follow-ups, reminders, review requests (save 10-20 hrs/week)
6. **CRM & Lead Management** — GoHighLevel/HubSpot setup, automated nurturing, pipeline tracking
7. **Custom AI Integrations** — chatbots, review management, content generation

### Objection Handling Framework:
- "I already have a website" → freshness/conversion angle
- "Can't afford it" → cost-of-inaction reframe
- "Need to think about it" → no-commitment discovery call
- "Already have someone" → AI edge differentiator
- "Does AI work for my industry?" → cross-industry proof

### Pricing Policy:
- NEVER discuss specific pricing on calls
- Always redirect to discovery call for tailored proposal

## 4. Testing Matrix

### Test A: Model Performance (same personality varies by model)
| Model | Agents | What We Learn |
|-------|--------|---------------|
| Gemini 2.5 Flash | ava-warm, ava-direct, ava-warm-flirty | Baseline model performance |
| GPT-4o Mini | chris-charming | OpenAI quality + latency tradeoff |
| Qwen3-30B-A3B | eric-authority | Ultra-low latency impact on conversions |

### Test B: Personality Performance (all on same offer/knowledge)
| Personality | Agent | Hypothesis |
|-------------|-------|------------|
| Warm | ava-warm | Safe baseline, good for trust-building |
| Direct | ava-direct | Better for busy owners who hate small talk |
| Flirty | ava-warm-flirty | Higher engagement/curiosity, longer calls |
| Charming | chris-charming | Male voice + relatability — different demo appeal |
| Authority | eric-authority | Social proof + expertise — premium positioning |

### Test C: Voice Gender
| Voice | Agents | What We Learn |
|-------|--------|---------------|
| Female (Hope) | ava-warm, ava-direct, ava-warm-flirty | Female voice performance |
| Male (Chris) | chris-charming | Male casual voice |
| Male (Eric) | eric-authority | Male authoritative voice |

### Isolation Note:
- Ava Warm vs Ava Direct vs Ava Flirty = **pure personality test** (same voice, same model)
- Chris vs Eric = **voice + personality + model** combined (can't isolate, but gives directional signal)
- To isolate model: compare Ava Warm (Gemini) booking rate vs Chris (GPT-4o Mini) — different voice, but personality-controlled

## 5. Tracking & Metrics

Per variant, tracked in `call_logs` table:

| Metric | How |
|--------|-----|
| Model used | `agent_variant` → lookup in variants.json |
| Personality type | `agent_variant` → personality field |
| Call volume | COUNT(*) per variant |
| Reply rate | Calls where prospect spoke > 2 turns / total calls |
| Positive intent rate | outcome IN (booked, interested, callback) / total |
| Meeting booked rate | outcome = booked / total |
| Avg call duration | AVG(duration_seconds) per variant |
| Cost per conversion | (cost/min × avg_duration × total_calls) / bookings |

**Endpoints:**
- `GET /api/call-stats` — overall stats
- `GET /api/call-stats?by=variant` — per-variant breakdown

## 6. Rollout Strategy: Parallel (Recommended)

### Phase 1: Equal Distribution (Week 1-2)
- All 5 variants enabled, equal weight (round-robin)
- Target: 50+ calls per variant = 250 total minimum
- No manual intervention — let data accumulate
- Daily check: `/api/call-stats?by=variant`

### Phase 2: Analysis + Pruning (Week 3)
- Kill any variant with <3% booking rate after 50+ calls
- Identify top 2-3 performers
- Shift to 60/20/20 weighted distribution (winner gets 60%)

### Phase 3: Epsilon-Greedy Bandit (Week 4+)
- 80% traffic to best performer
- 20% exploration across remaining variants
- Re-evaluate weekly
- Continuously test new challenger variants

### Phase 4: Winner + Challenger (Ongoing)
- 90% to proven winner
- 10% to new challenger variant (test new hooks, voices, models)
- Rotate challengers monthly
