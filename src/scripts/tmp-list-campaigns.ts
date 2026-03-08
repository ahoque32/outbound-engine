import { listCampaigns } from '../channels/instantly-adapter';

async function main() {
  const campaigns = await listCampaigns();
  const mapped = campaigns.map(c => ({ id: c.id, name: c.name, status: c.status }));
  console.log(JSON.stringify(mapped, null, 2));
}

void main();
