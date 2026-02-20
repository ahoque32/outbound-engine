// Quick test: send one email via AgentMail
import 'dotenv/config';
import { EmailAdapter } from '../channels/email-adapter';

async function main() {
  const adapter = new EmailAdapter();
  
  const result = await adapter.sendColdEmail(
    {
      id: 'test-001',
      name: 'Test User',
      email: 'jake@growthsiteai.org', // send to ourselves as a test
      campaignId: 'test',
      emailState: 'not_sent',
      // minimal required fields
    } as any,
    'Test email from Outbound Engine',
    'This is a test email sent via AgentMail from the outbound engine.\n\nIf you see this, the system works!',
    'hello@growthsiteai.org'
  );

  console.log('Result:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
