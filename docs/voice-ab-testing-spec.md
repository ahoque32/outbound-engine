# Voice Agent A/B Testing Spec

## Overview

Test multiple ElevenLabs voice agent variants using the **same Twilio number** (+17704077842) to find the highest-converting sales voice. The ElevenLabs outbound API already supports per-call `agent_id` — no extra numbers needed.

---

## 1. Agent Variants

### What to Vary

| Variant | Voice | Style | Opening Hook |
|---------|-------|-------|--------------|
| **ava-warm** (control) | Ava (current) | Friendly, consultative | "Hi {name}, I noticed your website and had a quick idea..." |
| **ava-direct** | Ava (same voice) | Confident, fast-paced | "Hi {name}, I help businesses like yours get more customers online — got 30 seconds?" |
| **alex-male** | Male voice (TBD) | Professional, calm | "Hey {name}, this is Alex — I work with local businesses on their web presence..." |
| **ava-authority** | Ava (same voice) | Expert positioning | "Hi {name}, we just helped a {industry} business in your area double their leads..." |

### What Stays Constant
- Product info (RenderWiseAI services, pricing)
- Booking flow (GHL calendar integration)
- Objection handling fundamentals
- Knowledge base / FAQ responses
- Phone number (+17704077842)

### What Changes Per Variant
- **Voice** — ElevenLabs voice ID in agent config
- **System prompt** — tone, pacing, opening hook
- **First message** — the opening line
- **Temperature/personality** — how conversational vs scripted

---

## 2. Code Changes Required

### `src/core/ab-router.ts` (NEW)

```typescript
interface AgentVariant {
  id: string;           // e.g. "ava-warm"
  agentId: string;      // ElevenLabs agent_id
  name: string;         // Display name
  weight: number;       // 1.0 = equal, higher = more traffic
  enabled: boolean;
  callCount: number;    // Runtime counter
}

// Phase 1: Round-robin
function selectVariant(variants: AgentVariant[]): AgentVariant {
  const enabled = variants.filter(v => v.enabled);
  // Pick the variant with fewest calls (balanced distribution)
  return enabled.sort((a, b) => a.callCount - b.callCount)[0];
}

// Phase 2: Multi-armed bandit (epsilon-greedy)
function selectVariantBandit(
  variants: AgentVariant[],
  stats: VariantStats[],
  epsilon: number = 0.2 // 20% exploration
): AgentVariant {
  if (Math.random() < epsilon) {
    // Explore: random pick
    return enabled[Math.floor(Math.random() * enabled.length)];
  }
  // Exploit: pick highest booking rate
  return enabled.sort((a, b) =>
    getBookingRate(b, stats) - getBookingRate(a, stats)
  )[0];
}
```

### `variants.json` (NEW — config file)

```json
{
  "variants": [
    {
      "id": "ava-warm",
      "agentId": "agent_2401kj14s2xveagtqe97g6w7pbh3",
      "name": "Ava - Warm & Consultative",
      "weight": 1.0,
      "enabled": true
    },
    {
      "id": "ava-direct",
      "agentId": "agent_XXXXXXXXX",
      "name": "Ava - Direct & Confident",
      "weight": 1.0,
      "enabled": true
    },
    {
      "id": "alex-male",
      "agentId": "agent_XXXXXXXXX",
      "name": "Alex - Professional Male",
      "weight": 1.0,
      "enabled": true
    }
  ],
  "strategy": "round-robin",
  "epsilon": 0.2,
  "minCallsBeforeBandit": 50
}
```

### `schema.sql` — Migrations

```sql
-- Add variant tracking to call_logs
ALTER TABLE call_logs ADD COLUMN agent_variant text;
ALTER TABLE call_logs ADD COLUMN agent_id_used text;
CREATE INDEX call_logs_variant ON call_logs(agent_variant);

-- Variant stats view
CREATE OR REPLACE VIEW variant_stats AS
SELECT
  agent_variant,
  COUNT(*) as total_calls,
  COUNT(*) FILTER (WHERE outcome = 'booked') as bookings,
  COUNT(*) FILTER (WHERE outcome = 'interested') as interested,
  COUNT(*) FILTER (WHERE outcome = 'not_interested') as not_interested,
  COUNT(*) FILTER (WHERE outcome = 'callback') as callbacks,
  ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'booked') / NULLIF(COUNT(*), 0), 1) as booking_rate,
  ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('booked', 'interested', 'callback')) / NULLIF(COUNT(*), 0), 1) as positive_rate,
  ROUND(AVG(duration_seconds), 0) as avg_duration_sec
FROM call_logs
WHERE agent_variant IS NOT NULL
GROUP BY agent_variant;
```

### `src/dialer/voice-agent.ts` — Changes

```typescript
// makeOutboundCall now accepts optional agentId override
async makeOutboundCall(toNumber: string, agentIdOverride?: string): Promise<OutboundCallResult> {
  const agentId = agentIdOverride || this.agentId;
  // ... rest unchanged, just use agentId variable
}
```

### `api/post-call-webhook.ts` — Changes

```typescript
// When logging the call, include variant info
// Lookup which variant was used by matching agent_id from the conversation data
const variant = variants.find(v => v.agentId === conversationData.agent_id);
// Include in call_logs insert:
// agent_variant: variant?.id || 'unknown',
// agent_id_used: conversationData.agent_id
```

### `api/call-stats.ts` — Add Variant Breakdown

```typescript
// New endpoint or extend existing:
// GET /api/call-stats?by=variant
// Returns: { variants: [ { id, name, total, booked, rate, avgDuration }, ... ] }
// Query the variant_stats view
```

### Hunter Orchestrator — Changes

```typescript
// Before making a call, select variant:
import { selectVariant } from '../core/ab-router';
import variants from '../../variants.json';

const variant = selectVariant(variants.variants);
const result = await voiceAgent.makeOutboundCall(prospect.phone, variant.agentId);
// Log variant.id alongside the call
```

---

## 3. Metrics & Measurement

### Primary Metric
- **Booking rate** per variant (bookings / total calls)

### Secondary Metrics
- Interest rate (interested + callback + booked / total)
- Average call duration (longer ≠ better, but very short = hung up)
- Callback request rate
- Not-interested rate
- Voicemail rate (control for this — not the agent's fault)

### Statistical Significance
- **Minimum 50 calls per variant** before comparing
- At 4 variants × 50 calls = 200 total calls minimum for Phase 1
- Use simple chi-squared test or just eyeball if differences are >5pp
- Don't kill a variant early unless it's catastrophically bad (<2% booking rate after 30+ calls)

### Confounders to Control
- **Time of day** — distribute variants evenly across call windows
- **Day of week** — same
- **Industry** — if possible, stratify by industry so each variant gets a mix
- **Lead quality** — random assignment handles this at scale

---

## 4. Routing Strategy

### Phase 1: Round-Robin (Week 1-2)
- Equal distribution across all enabled variants
- Goal: collect baseline data on each variant
- Pure random or least-calls-first assignment
- **No manual intervention** — let the data accumulate

### Phase 2: Epsilon-Greedy Bandit (Week 3+)
- 80% traffic to best-performing variant
- 20% exploration across others (to catch up if a variant improves)
- Re-evaluate weekly
- Kill variants that are statistically worse after 100+ calls
- Requires `minCallsBeforeBandit: 50` threshold before switching strategies

### Phase 3: Winner Takes All
- Once a clear winner emerges (>3pp booking rate advantage, 100+ calls each)
- Route 100% to winner
- Retire losing variants
- Start new A/B test with winner vs new challenger

---

## 5. ElevenLabs Setup

### Creating New Agent Variants

1. Go to [ElevenLabs Dashboard](https://elevenlabs.io/app/conversational-ai)
2. Find existing Ava agent (`agent_2401kj14s2xveagtqe97g6w7pbh3`)
3. **Clone it** (or create new from scratch with same knowledge base)
4. For each variant, change:
   - **Voice** — pick from ElevenLabs voice library (or clone a custom voice)
   - **System Prompt** — adjust tone/personality/opening
   - **First Message** — the hook
   - **Agent Name** — for dashboard identification
5. Copy each new `agent_id` into `variants.json`
6. **Do NOT change:** knowledge base, tool configs (booking webhooks), phone number

### Cost
- Same per-minute pricing regardless of agent variant
- No extra cost for multiple agents
- Only cost increase is from making more total calls (which you'd do anyway)

### Webhook
- All variants use the same post-call webhook URL
- The webhook payload includes `agent_id`, so we can match to variant automatically

---

## 6. Implementation Plan

| Step | What | Effort | Blocked On |
|------|------|--------|------------|
| 1 | Create 2-3 new agents in ElevenLabs dashboard | 30 min | Ahawk picks voices + scripts |
| 2 | Add `variants.json` config | 10 min | Agent IDs from step 1 |
| 3 | Run SQL migration (add columns + view) | 5 min | — |
| 4 | Build `ab-router.ts` | 30 min | — |
| 5 | Update `voice-agent.ts` (accept dynamic agent_id) | 10 min | — |
| 6 | Update `post-call-webhook.ts` (capture variant) | 15 min | — |
| 7 | Update `call-stats.ts` (variant breakdown) | 20 min | — |
| 8 | Update Hunter orchestrator (variant selection before calls) | 15 min | — |
| 9 | Test with dry-run calls | 15 min | Steps 1-8 |
| 10 | Go live — Phase 1 round-robin | 0 | Steps 1-9 |

**Total dev effort:** ~2 hours (Dante can do steps 2-8 in one sprint)
**Ahawk input needed:** Step 1 — which voices and script styles to test

### What Dante Can Build Now (no Ahawk input needed)
- Steps 2-8 with placeholder agent IDs
- The entire routing + tracking infrastructure
- Ahawk just plugs in real agent IDs later

### What Needs Ahawk
- Voice selection (browse ElevenLabs voice library, pick 2-3 voices)
- Script variant approval (review the 4 opening hooks above)
- Green light to start making calls

---

## Quick Start (After Merge)

```bash
# 1. Run migration
psql $DATABASE_URL < docs/migrations/add-variant-tracking.sql

# 2. Create agents in ElevenLabs, get agent_ids

# 3. Update variants.json with real agent_ids

# 4. Deploy to Vercel
vercel --prod

# 5. Import prospects + start Hunter
# Calls will auto-distribute across variants
```
