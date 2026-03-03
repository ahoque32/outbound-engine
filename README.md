# Outbound Engine

Multi-channel outbound sales orchestration system for RenderWiseAI.

## Current Status

| Channel | Status | Notes |
|---------|--------|-------|
| **Voice** | ✅ Active | ElevenLabs + Twilio, 75 calls/day |
| **Email** | ✅ Ready | Instantly.ai campaigns via GWS, all 6 inboxes at 100 warmup score |
| **LinkedIn** | ❌ Disabled | — |
| **X/Twitter** | ❌ Disabled | — |

## Architecture

```
Prospect (Supabase)
    │
    ├── Voice Channel ──→ ElevenLabs API ──→ Twilio Call ──→ Post-Call Webhook
    │                                                         ├── Transcript → #outbound-transcripts
    │                                                         └── Booking → GHL + #booking-confirmation
    │
    └── Email Channel ──→ Instantly.ai Campaign API ──→ GWS Sender Accounts ──→ Prospect Inbox
                           ├── Daily campaign: "RenderWise Outbound - YYYY-MM-DD"
                           ├── Schedule: Mon-Fri, 9am-5pm ET
                           ├── Health gate: warmup score ≥ 80 required
                           └── Webhooks: reply, open, bounce, unsubscribe
```

## Email Pipeline

**Sending Infrastructure:** Instantly.ai (campaigns + delivery through warmed GWS accounts)
**NOT AgentMail** — AgentMail is for transactional/agent emails only.

### How it works

1. **Health gate** checks Instantly warmup scores for all sender accounts
2. **`ensureCampaign()`** creates or reuses a daily campaign (`RenderWise Outbound - YYYY-MM-DD`)
3. Campaign is configured: Mon-Fri, 9am-5pm ET, all healthy senders mapped
4. **Lead is created** in Instantly via `/leads` API with campaign ID + personalization
5. **Instantly delivers** the email through the GWS accounts it warmed up
6. **Webhooks** fire back to our engine on reply/open/bounce/unsubscribe

### Sender Accounts (6 burner inboxes)

| Email | Domain |
|-------|--------|
| jake@growthsiteai.org | growthsiteai.org |
| jake.mitchell@growthsiteai.org | growthsiteai.org |
| hello@growthsiteai.org | growthsiteai.org |
| alex.turner@siteflowagency.org | siteflowagency.org |
| hello@siteflowagency.org | siteflowagency.org |
| mike@nextwavedesigns.org | nextwavedesigns.org |

> ⚠️ **Never cold-outreach from renderwise.net or renderwiseai.com**

### Key Files

- `src/channels/email-adapter.ts` — Campaign-based delivery with health gate
- `src/channels/instantly-adapter.ts` — Instantly API v2 client (accounts, campaigns, leads, warmup)
- `src/channels/instantly-types.ts` — Type definitions

## Voice Pipeline (Hunter Dialer)

### Daily Workflow Rules

1. **Daily Lead Cap**: Max 75 calls/day (hard limit)
2. **Transcript Upload**: Every completed call → posted to #outbound-transcripts
3. **Outcome Labels**: All transcripts labeled:
   - ✅ INTERESTED
   - 📬 VOICEMAIL
   - ❓ UNKNOWN
   - 📞 CALLBACK
4. **Agent Distribution**: Round-robin across all active agents

### Voice Agents

| Agent | Style | Model |
|-------|-------|-------|
| ava-warm | Warm & Consultative | Gemini 2.5 Flash |
| ava-direct | Direct & Fast | Gemini 2.5 Flash |
| ava-warm-flirty | Playful | Gemini 2.5 Flash |
| chris-charming | Casual Male | GPT-4o Mini |
| eric-authority | Authoritative | Qwen3-30B-A3B |

### Key Files

- `src/dialer/call-engine.ts` — Main dialer logic
- `src/dialer/voice-agent.ts` — ElevenLabs integration
- `src/dialer/call-script.ts` — Personalization
- `src/core/ab-router.ts` — Round-robin agent selector

## Project Structure

```
outbound-engine/
├── src/
│   ├── channels/         # Channel adapters
│   │   ├── email-adapter.ts        # Instantly campaign delivery
│   │   ├── instantly-adapter.ts    # Instantly API v2 client
│   │   ├── instantly-types.ts      # Type definitions
│   │   ├── voice-adapter.ts        # Voice channel
│   │   ├── linkedin-adapter.ts     # LinkedIn (disabled)
│   │   └── x-adapter.ts           # X/Twitter (disabled)
│   ├── dialer/           # Hunter voice dialer
│   ├── core/             # State machine, rate limiter, sequences
│   ├── webhooks/         # Post-call, Discord notifier
│   ├── scripts/          # CLI: run-dialer, import-leads, daily-report
│   └── types/            # Shared types
├── docs/
│   └── INSTANTLY-INTEGRATION-SPEC.md
└── server.ts
```

## Usage

```bash
# Run voice dialer (75 calls/day max)
npx ts-node src/scripts/run-dialer.ts --limit 75 --live

# Run daily email + voice sequences
npx ts-node src/scripts/daily-sequence.ts

# Import leads from CSV/Excel
npx ts-node src/scripts/import-leads.ts --file leads.csv

# Daily report
npx ts-node src/scripts/daily-report.ts
```

## Environment Variables

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
INSTANTLY_API_KEY=           # Instantly.ai email campaigns
ELEVENLABS_API_KEY=          # Voice agents
TWILIO_ACCOUNT_SID=          # Outbound calls
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
AGENTMAIL_API_KEY=           # Transactional emails only (not cold outreach)
```

## Discord Channels

- **#outbound-dialer** — Dialer status
- **#outbound-transcripts** — Call transcripts with outcome labels
- **#booking-confirmation** — Meeting booking alerts
- **#outbound-reports** — Daily/weekly reports
