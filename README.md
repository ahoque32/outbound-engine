# Outbound Engine

Multi-channel outbound sales orchestration system.

## Architecture

- **Campaign Manager**: Define ICP, messaging, sequences
- **Prospect State Machine**: Track prospect states across channels
- **Sequence Engine**: Execute multi-touch sequences
- **Rate Limiter**: Prevent channel limits
- **Channel Adapters**: LinkedIn, X, Email, Voice

## Project Structure

```
outbound-engine/
├── schema/                 # Supabase schema definitions
├── src/
│   ├── core/              # Core orchestration logic
│   │   ├── state-machine.ts
│   │   ├── sequence-engine.ts
│   │   └── rate-limiter.ts
│   ├── channels/          # Channel adapters
│   │   ├── linkedin-adapter.ts
│   │   ├── x-adapter.ts
│   │   ├── email-adapter.ts
│   │   └── voice-adapter.ts
│   ├── scripts/           # Utility scripts
│   │   ├── import-leads.ts
│   │   └── daily-report.ts
│   └── types/             # TypeScript types
├── package.json
└── README.md
```

## Setup

1. Install dependencies: `npm install`
2. Set up Supabase tables (see schema/)
3. Configure environment variables
4. Run import script: `npm run import:leads`
5. Run daily sequence: `npm run daily`

## Usage

```bash
# Import leads from CSV
npm run import:leads -- --file leads.csv --campaign renderwise-v1

# Run daily sequence execution
npm run daily

# Generate daily report
npm run report
```
