# Voice Agent A/B Testing Spec

> **Status:** Draft · **Author:** Dante (AI) · **Date:** 2026-02-22

## Overview

We currently run a single ElevenLabs voice agent (Ava, `agent_2401kj14s2xveagtqe97g6w7pbh3`) for all outbound calls through one Twilio number (`phnum_1901kj1b9emsek6tsjef1gewr3tm`). This spec defines how to A/B test **3-4 agent variants** using the same Twilio number to find the highest-ROI voice approach.

**Key insight:** The ElevenLabs outbound call API accepts `agent_id` per call while `agent_phone_number_id` stays constant — no Twilio changes needed.

---

## 1. Agent Variants Design

### Proposed Variants

| Variant | Name | Voice | Style | Opening Hook |
|---------|------|-------|-------|-------------|
| A (control) | **Ava-Warm** | Current Ava voice | Friendly, conversational, mid tempo | "Hey {firstName}! This is Ava from RenderWise AI — I was just looking at {company}'s site and had a quick thought..." |
| B | **Ava-Direct** | Same Ava voice | Assertive, faster tempo, value-first | "Hi {firstName}, Ava here from RenderWise. We help businesses like {company} capture 3x more leads from their website — got 30 seconds?" |
| C | **Alex-Male** | Male voice (ElevenLabs stock or cloned) | Professional, consultative | "Hey {firstName}, this is Alex with RenderWise AI. I've been researching {industry} companies in {location} and {company} caught my eye..." |
| D | **Ava-Consultative** | Current Ava voice | Slower, question-led, diagnostic | "Hi {firstName}, this is Ava from RenderWise AI. Quick question — when someone lands on {company}'s website right now, how are you capturing those leads?" |

### What to Vary Per Variant
- **Voice:** voice_id in ElevenLabs agent config
- **Opening hook:** first_message / system prompt intro
- **Personality/tempo:** system prompt personality instructions, stability/similarity settings
- **Conversation style:** direct pitch vs question-led vs warm rapport

### What Stays Constant (All Variants)
- Product information (RenderWise AI value prop, pricing, features)
- Booking flow (same GHL calendar, same availability check)
- Objection handling fundamentals (same core rebuttals)
- Data collection (name confirmation, email capture, callback scheduling)
- Phone number (same Twilio number for all)

---

## 2. Code Changes Required

### 2.1 New File: `src/core/ab-router.ts`

A/B routing logic. Selects which variant to use for each call.

```typescript
// src/core/ab-router.ts
import { createClient } from '@supabase/supabase-js';

export interface AgentVariant {
  id: string;           // e.g. "ava-warm"
  name: string;         // e.g. "Ava-Warm (Control)"
  agentId: string;      // ElevenLabs agent_id
  weight: number;       // 1.0 = equal, higher = more traffic
  enabled: boolean;
}

export interface VariantSelection {
  variant: AgentVariant;
  method: 'round-robin' | 'weighted-random' | 'bandit';
}

// Load from config
const VARIANTS_CONFIG: AgentVariant[] = JSON.parse(
  process.env.AB_VARIANTS || '[]'
);

let roundRobinIndex = 0;

export function getEnabledVariants(): AgentVariant[] {
  return VARIANTS_CONFIG.filter(v => v.enabled);
}

/**
 * Phase 1: Round-robin selection (equal distribution)
 */
export function selectVariantRoundRobin(): VariantSelection {
  const enabled = getEnabledVariants();
  if (enabled.length === 0) throw new Error('No enabled variants');
  
  const variant = enabled[roundRobinIndex % enabled.length];
  roundRobinIndex++;
  
  return { variant, method: 'round-robin' };
}

/**
 * Phase 2: Weighted random (for manual tuning or bandit)
 */
export function selectVariantWeighted(): VariantSelection {
  const enabled = getEnabledVariants();
  const totalWeight = enabled.reduce((sum, v) => sum + v.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const variant of enabled) {
    random -= variant.weight;
    if (random <= 0) return { variant, method: 'weighted-random' };
  }
  
  return { variant: enabled[0], method: 'weighted-random' };
}
```

### 2.2 Config: `variants.json`

```json
[
  {
    "id": "ava-warm",
    "name": "Ava-Warm (Control)",
    "agentId": "agent_2401kj14s2xveagtqe97g6w7pbh3",
    "weight": 1.0,
    "enabled": true
  },
  {
    "id": "ava-direct",
    "name": "Ava-Direct",
    "agentId": "agent_XXXXXXXXXXXXXXXXXXXXXXXX",
    "weight": 1.0,
    "enabled": true
  },
  {
    "id": "alex-male",
    "name": "Alex-Male",
    "agentId": "agent_YYYYYYYYYYYYYYYYYYYYYYYY",
    "weight": 1.0,
    "enabled": true
  },
  {
    "id": "ava-consultative",
    "name": "Ava-Consultative",
    "agentId": "agent_ZZZZZZZZZZZZZZZZZZZZZZZZ",
    "weight": 1.0,
    "enabled": true
  }
]
```

Can also be loaded via `AB_VARIANTS` env var (JSON string) for quick toggling without deploys.

### 2.3 Modify: `src/dialer/voice-agent.ts`

**Change:** Accept dynamic `agent_id` per call instead of using the singleton.

```diff
- async makeOutboundCall(toNumber: string): Promise<OutboundCallResult> {
+ async makeOutboundCall(toNumber: string, overrideAgentId?: string): Promise<OutboundCallResult> {
+   const agentId = overrideAgentId || this.agentId;
    ...
    body: JSON.stringify({
-     agent_id: this.agentId,
+     agent_id: agentId,
      agent_phone_number_id: this.phoneNumberId,
      to_number: toNumber,
    }),
```

### 2.4 Modify: `src/dialer/call-engine.ts`

**Change:** Import router, select variant before each call, pass to `makeOutboundCall`, log variant.

```diff
+ import { selectVariantRoundRobin, VariantSelection } from '../core/ab-router';

  // In callProspect():
+ const { variant, method } = selectVariantRoundRobin();
+ console.log(`[CallEngine] Selected variant: ${variant.name} (${method})`);

  // Pass to makeOutboundCall:
- const outboundResult = await voiceAgent.makeOutboundCall(prospect.phone);
+ const outboundResult = await voiceAgent.makeOutboundCall(prospect.phone, variant.agentId);

  // In createCallLog — include variant:
  .insert({
    prospect_id: prospect.id,
    campaign_id: prospect.campaignId,
+   agent_variant: variant.id,
    status: this.config.dryRun ? 'dry_run' : 'initiated',
    direction: 'outbound',
  })
```

### 2.5 Schema Changes: `schema.sql`

```sql
-- Add agent_variant to call_logs
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS agent_variant text;

-- Index for fast variant-grouped queries
CREATE INDEX IF NOT EXISTS idx_call_logs_agent_variant ON call_logs(agent_variant);
```

No changes needed to `prospects` table — variant is per-call, not per-prospect (a prospect may be called by different variants across retries).

### 2.6 New File: `api/call-stats.ts` (or extend `src/scripts/dialer-report.ts`)

Add a variant-grouped stats endpoint/report:

```typescript
// Variant performance query
const { data } = await supabase.rpc('variant_stats') // or raw SQL:

/*
SELECT
  agent_variant,
  COUNT(*) as total_calls,
  COUNT(*) FILTER (WHERE outcome = 'booked') as booked,
  COUNT(*) FILTER (WHERE outcome = 'interested') as interested,
  COUNT(*) FILTER (WHERE outcome = 'not_interested') as not_interested,
  COUNT(*) FILTER (WHERE outcome = 'callback') as callbacks,
  ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'booked') / NULLIF(COUNT(*), 0), 1) as booking_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'interested') / NULLIF(COUNT(*), 0), 1) as interest_rate_pct,
  ROUND(AVG(duration_seconds), 0) as avg_duration_sec
FROM call_logs
WHERE agent_variant IS NOT NULL
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY agent_variant
ORDER BY booking_rate_pct DESC;
*/
```

### 2.7 Webhook: `src/webhooks/book-appointment.ts`

Ensure the post-call webhook (ElevenLabs → our server) captures which conversation maps to which variant. The `conversation_id` returned from `makeOutboundCall` is already logged alongside `agent_variant` in `call_logs`, so no webhook changes needed — just join on `conversation_id` or `twilio_call_sid`.

---

## 3. Metrics & Dashboard

### Primary Metric
- **Booking rate** = `booked / total_answered` per variant

### Secondary Metrics
| Metric | Formula |
|--------|---------|
| Interest rate | `interested / total_answered` |
| Avg call duration | `AVG(duration_seconds)` where answered |
| Callback rate | `callback / total_answered` |
| Not-interested rate | `not_interested / total_answered` |
| Voicemail rate | `voicemail / total_calls` |

### Statistical Significance

- **Minimum sample:** 50 answered calls per variant before comparing
- **Recommended:** 100+ per variant for reliable signal
- With 4 variants at ~50 calls/day, expect **4-8 business days** to reach 50/variant
- Use a simple chi-squared test or Fisher's exact test on booking counts
- **Don't prematurely kill variants** — random variance is high at low N

### Reporting

Add variant breakdown to the existing `dialer-report.ts` daily summary. Example output:

```
📊 A/B Test Report (Last 7 Days)
─────────────────────────────────────
Ava-Warm (Control): 52 calls → 4 booked (7.7%) ⭐
Ava-Direct:         48 calls → 6 booked (12.5%) 🔥
Alex-Male:          51 calls → 3 booked (5.9%)
Ava-Consultative:   49 calls → 5 booked (10.2%)
─────────────────────────────────────
Note: Need 50+ calls/variant for significance
```

---

## 4. Routing Strategy

### Phase 1: Round-Robin (Week 1-2)
- Equal distribution across all enabled variants
- Goal: collect baseline data, 50+ calls per variant
- Simple `index++ % variants.length` counter (in-memory, resets on deploy — fine for this)

### Phase 2: Weighted Random / Manual Tuning (Week 3-4)
- Review Phase 1 data, disable clear losers
- Shift weight toward top 2 performers (e.g., 40/40/10/10)
- Update `variants.json` weights

### Phase 3 (Optional): Multi-Armed Bandit
- Thompson Sampling or UCB1 algorithm
- Automatically shifts traffic toward winners while still exploring
- Only worth building if A/B testing becomes ongoing (not just a one-time experiment)

### Stratification Considerations
- **Time of day:** Log call hour alongside variant; check for time-variant confounds in analysis
- **Industry/segment:** If volume allows, analyze per-segment. Otherwise assume uniform distribution via round-robin
- **Timezone:** Already handled by existing `isBusinessHours()` — no change needed

---

## 5. ElevenLabs Setup Steps

### Creating New Agent Variants

1. Go to [ElevenLabs Dashboard](https://elevenlabs.io/app/conversational-ai) → Agents
2. Find existing agent `agent_2401kj14s2xveagtqe97g6w7pbh3` (Ava)
3. Click **Duplicate** to clone it
4. For each variant, modify:

| Setting | Ava-Direct (B) | Alex-Male (C) | Ava-Consultative (D) |
|---------|----------------|---------------|----------------------|
| Agent name | `Ava-Direct` | `Alex-Male` | `Ava-Consultative` |
| Voice | Same as control | Pick male voice from library | Same as control |
| First message | Direct value prop hook | Research-based hook | Question-led hook |
| System prompt | Add "be direct, lead with value, keep tempo fast" | Change name to Alex, professional tone | Add "ask diagnostic questions before pitching" |
| Stability | Same | Same | Slightly higher (calmer) |

5. **Do NOT change:** Twilio phone number config, tool/function calls (booking API), knowledge base
6. Copy each new `agent_id` into `variants.json`

### Cost Implications
- ElevenLabs charges **per minute of conversation**, not per agent
- Creating additional agents is **free** — no extra cost
- Total spend stays the same (same call volume, just split across variants)

---

## 6. Implementation Plan

| Step | Task | Effort | Blocker |
|------|------|--------|---------|
| 1 | Run schema migration (add `agent_variant` column) | 5 min | None |
| 2 | Create `src/core/ab-router.ts` | 30 min | None |
| 3 | Modify `voice-agent.ts` — add `overrideAgentId` param | 10 min | None |
| 4 | Modify `call-engine.ts` — integrate router, log variant | 30 min | None |
| 5 | Add variant stats query to `dialer-report.ts` | 30 min | None |
| 6 | Create `variants.json` config | 5 min | None |
| 7 | **Create agent variants in ElevenLabs dashboard** | 1 hr | ⚠️ Needs Ahawk input on voice selection + script tweaks |
| 8 | Populate `variants.json` with new agent IDs | 5 min | Depends on step 7 |
| 9 | Deploy + test with DRY_RUN | 30 min | None |
| 10 | Go live — Phase 1 round-robin | 0 | None |
| 11 | Review after 50+ calls/variant, adjust weights | — | Data collection time |

**Total dev effort:** ~2.5 hours (steps 1-6, 9)

### What Can Be Done Now (No Ahawk Input Needed)
- Steps 1-6: All code/schema changes
- Step 9: Dry run testing

### What Needs Ahawk's Input
- **Step 7:** Which voices to use for each variant, exact opening hooks, personality tweaks
- **After Phase 1:** Decision on which variants to keep/kill/tune

---

## Appendix: Quick Reference

```bash
# Enable A/B testing (env var approach)
export AB_VARIANTS='[{"id":"ava-warm","name":"Ava-Warm","agentId":"agent_2401kj14s2xveagtqe97g6w7pbh3","weight":1,"enabled":true},{"id":"ava-direct","name":"Ava-Direct","agentId":"agent_XXX","weight":1,"enabled":true}]'

# Check variant stats (SQL)
SELECT agent_variant, COUNT(*), 
  ROUND(100.0 * COUNT(*) FILTER (WHERE outcome='booked') / COUNT(*), 1) as book_rate
FROM call_logs WHERE agent_variant IS NOT NULL
GROUP BY agent_variant;

# Disable a variant mid-test
# Just set "enabled": false in variants.json and redeploy
```
