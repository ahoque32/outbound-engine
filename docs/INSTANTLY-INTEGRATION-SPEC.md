# Instantly.ai Integration Spec

## Overview
Integrate Instantly.ai as the email warmup, deliverability, verification, and rotation layer for our outbound engine. Instantly handles sending infrastructure; we handle strategy, sequences, and analytics.

## API Details
- **Base URL:** `https://api.instantly.ai/api/v2`
- **Auth:** `Authorization: Bearer <INSTANTLY_API_KEY>` (env var in .env)
- **API Key:** Stored in .env as `INSTANTLY_API_KEY`

## Files to Create

### 1. `src/channels/instantly-adapter.ts`
Implements the channel adapter interface for Instantly. Key methods:

```typescript
// Account management
listAccounts(): Promise<InstantlyAccount[]>
getAccount(email: string): Promise<InstantlyAccount>

// Warmup management  
enableWarmup(emails: string[]): Promise<BackgroundJob>
disableWarmup(emails: string[]): Promise<BackgroundJob>
getWarmupAnalytics(emails: string[]): Promise<WarmupAnalytics>

// Health gate - check before sending
isHealthy(email: string): Promise<boolean>  // warmup_score >= 80 && status === 1

// Email verification
verifyEmails(emails: string[]): Promise<VerificationResult[]>

// Campaign management (for inbox rotation)
createCampaign(params: CampaignParams): Promise<Campaign>
addLeadsToCampaign(campaignId: string, leads: Lead[]): Promise<void>
getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics>
```

### 2. `src/channels/instantly-types.ts`
Type definitions for Instantly API responses:

```typescript
interface InstantlyAccount {
  email: string
  status: number          // 1=Active, 2=Paused, -1=ConnError, -2=SoftBounce, -3=SendError
  warmup_status: number   // 0=Paused, 1=Active, -1=Banned, -2=SpamUnknown, -3=PermSuspend
  stat_warmup_score: number | null
  daily_limit: number | null
  sending_gap: number
  provider_code: number   // 1=Custom, 2=Google, 3=Microsoft, 4=AWS, 8=AirMail
  first_name: string
  last_name: string
  warmup: {
    limit: number
    reply_rate: number
    increment: string
    warmup_custom_ftag: string
    advanced: object
  }
}

interface WarmupAnalytics {
  email_date_data: Record<string, Record<string, {
    sent: number
    landed_inbox: number
    landed_spam: number
    received: number
  }>>
  aggregate_data: Record<string, {
    sent: number
    landed_inbox: number
    landed_spam: number
    received: number
    health_score_label: string
    health_score: number
  }>
}

interface VerificationResult {
  email: string
  status: 'valid' | 'invalid' | 'catch-all' | 'unknown'
  disposable: boolean
}

interface BackgroundJob {
  id: string
  type: string
  status: 'pending' | 'in-progress' | 'success' | 'failed'
  progress: number
}
```

### 3. `scripts/instantly-health.sh`
Shell script for Inspector to call:

```bash
#!/bin/bash
# Checks warmup health for all connected accounts
# Outputs structured data for Inspector's nightly audit

API_KEY=$(grep INSTANTLY_API_KEY ~/outbound-engine/.env | cut -d= -f2)

# List all accounts
echo "=== INSTANTLY ACCOUNTS ==="
curl -s -H "Authorization: Bearer $API_KEY" \
  "https://api.instantly.ai/api/v2/accounts?limit=100" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data.get('items', []):
    email = a['email']
    status = a['status']
    warmup = a.get('warmup_status', '?')
    score = a.get('stat_warmup_score', 'N/A')
    print(f'  {email}: status={status} warmup={warmup} score={score}')
"

# Get warmup analytics for all accounts
EMAILS=$(curl -s -H "Authorization: Bearer $API_KEY" \
  "https://api.instantly.ai/api/v2/accounts?limit=100" | python3 -c "
import json, sys
data = json.load(sys.stdin)
emails = [a['email'] for a in data.get('items', [])]
print(json.dumps(emails))
")

if [ "$EMAILS" != "[]" ]; then
  echo ""
  echo "=== WARMUP ANALYTICS ==="
  curl -s -X POST -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    "https://api.instantly.ai/api/v2/accounts/warmup-analytics" \
    -d "{\"emails\": $EMAILS}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
agg = data.get('aggregate_data', {})
for email, stats in agg.items():
    score = stats.get('health_score', 'N/A')
    inbox = stats.get('landed_inbox', 0)
    spam = stats.get('landed_spam', 0)
    total = inbox + spam
    rate = f'{inbox/total*100:.0f}%' if total > 0 else 'N/A'
    status = '✅ READY' if score and score >= 80 else '🟡 WARMING' if score and score >= 60 else '🔴 HOLD'
    print(f'  {email}: {rate} inbox | score={score} | {status}')
"
fi
```

### 4. `api/verify-leads.ts` (Vercel serverless)
Endpoint to verify a batch of emails before sending:

```typescript
// POST /api/verify-leads
// Body: { emails: string[] }
// Returns: { results: VerificationResult[] }
// Use Instantly's email verification API
```

### 5. Update `src/channels/email-adapter.ts`
Add domain health gate:

```typescript
// Before sending any email:
// 1. Check Instantly warmup score for sender domain
// 2. If score < 80 → skip this domain, try next
// 3. If all domains unhealthy → pause email sequence, alert
```

## Integration Points

### Outbound Engine → Instantly (sending)
When our sequence engine decides to send an email:
1. Pick sender from rotation pool (Instantly handles this via campaign accounts)
2. Check health gate (warmup score >= 80)
3. Push lead to Instantly campaign via API
4. Instantly sends with its own rotation logic

### Instantly → Our Engine (replies)
1. Set up webhook on Instantly: POST to our Vercel endpoint
2. Webhook fires on: reply, bounce, unsubscribe
3. Our endpoint: update Supabase prospect status, trigger next sequence step

### Inspector → Instantly (monitoring)
1. Inspector runs `scripts/instantly-health.sh` during nightly audit
2. Checks warmup scores, inbox placement rates
3. Reports to Anton via Convex if any domain drops below threshold

## Environment Variables
```
INSTANTLY_API_KEY=<already in .env>
```

## Provider Codes
- 1: Custom IMAP/SMTP
- 2: Google
- 3: Microsoft  
- 4: AWS
- 8: AirMail

## Notes
- Accounts must be added via Instantly dashboard (SMTP/IMAP or Google OAuth required)
- AgentMail stays for transactional/agent emails, NOT cold outreach
- Instantly Growth plan includes: warmup, campaigns, leads, verification, rotation
- Enable `slow_ramp: true` on new accounts to gradually increase sending limits
