#!/bin/bash
# Instantly Health Check Script
# Checks warmup health for all connected accounts
# Outputs structured data for Inspector's nightly audit

set -e

# Get the API key from .env
ENV_FILE="${HOME}/outbound-engine/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found at $ENV_FILE"
    exit 1
fi

API_KEY=$(grep INSTANTLY_API_KEY "$ENV_FILE" | cut -d= -f2 | tr -d ' ')

if [ -z "$API_KEY" ]; then
    echo "Error: INSTANTLY_API_KEY not found in .env"
    exit 1
fi

API_BASE="https://api.instantly.ai/api/v2"

# List all accounts
echo "=== INSTANTLY ACCOUNTS ==="
ACCOUNTS_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" \
  "${API_BASE}/accounts?limit=100")

# Check if response is valid JSON
if ! echo "$ACCOUNTS_RESPONSE" | python3 -c "import json, sys; json.load(sys.stdin)" 2>/dev/null; then
    echo "Error: Invalid response from Instantly API"
    echo "Response: $ACCOUNTS_RESPONSE"
    exit 1
fi

# Parse and display accounts
echo "$ACCOUNTS_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
items = data.get('items', [])
if not items:
    print('  No accounts found')
for a in items:
    email = a.get('email', 'unknown')
    status = a.get('status', '?')
    warmup = a.get('warmup_status', '?')
    score = a.get('stat_warmup_score', 'N/A')
    daily_limit = a.get('daily_limit', 'N/A')
    provider = a.get('provider_code', '?')
    print(f'  {email}: status={status} warmup={warmup} score={score} limit={daily_limit} provider={provider}')
print(f'\nTotal accounts: {len(items)}')
"

# Get warmup analytics for all accounts
EMAILS=$(echo "$ACCOUNTS_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
emails = [a['email'] for a in data.get('items', []) if 'email' in a]
print(json.dumps(emails))
")

if [ "$EMAILS" != "[]" ] && [ -n "$EMAILS" ]; then
  echo ""
  echo "=== WARMUP ANALYTICS ==="
  
  ANALYTICS_RESPONSE=$(curl -s -X POST -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    "${API_BASE}/accounts/warmup-analytics" \
    -d "{\"emails\": $EMAILS}")
  
  # Check if analytics response is valid
  if ! echo "$ANALYTICS_RESPONSE" | python3 -c "import json, sys; json.load(sys.stdin)" 2>/dev/null; then
      echo "Error: Invalid analytics response from Instantly API"
      echo "Response: $ANALYTICS_RESPONSE"
      exit 1
  fi
  
  echo "$ANALYTICS_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
agg = data.get('aggregate_data', {})

if not agg:
    print('  No analytics data available')
    sys.exit(0)

healthy_count = 0
warming_count = 0
hold_count = 0

for email, stats in agg.items():
    score = stats.get('health_score')
    inbox = stats.get('landed_inbox', 0)
    spam = stats.get('landed_spam', 0)
    sent = stats.get('sent', 0)
    received = stats.get('received', 0)
    total = inbox + spam
    
    if total > 0:
        rate = f'{inbox/total*100:.0f}%'
    else:
        rate = 'N/A'
    
    if score and score >= 80:
        status = '✅ READY'
        healthy_count += 1
    elif score and score >= 60:
        status = '🟡 WARMING'
        warming_count += 1
    else:
        status = '🔴 HOLD'
        hold_count += 1
    
    print(f'  {email}: {rate} inbox | sent={sent} recv={received} | score={score} | {status}')

print(f'\nSummary: {healthy_count} ready, {warming_count} warming, {hold_count} hold')
"

  echo ""
  echo "=== HEALTH SUMMARY ==="
  
  # Overall health check
  UNHEALTHY=$(echo "$ANALYTICS_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
agg = data.get('aggregate_data', {})
unhealthy = [email for email, stats in agg.items() 
             if not stats.get('health_score') or stats.get('health_score', 0) < 80]
if unhealthy:
    print(','.join(unhealthy))
")

  if [ -n "$UNHEALTHY" ]; then
      echo "⚠️  Unhealthy accounts detected: $UNHEALTHY"
      exit 1
  else
      echo "✅ All accounts healthy (score >= 80)"
  fi
else
  echo ""
  echo "=== WARMUP ANALYTICS ==="
  echo "  No accounts to check"
fi

echo ""
echo "=== CHECK COMPLETE ==="
