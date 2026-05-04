# @izenzo/sdk

TypeScript SDK for the [Izenzo Trade API](https://izenzo.co.za) — compliance-grade trade matching, entity governance, and evidence infrastructure.

## Install

```bash
npm install @izenzo/sdk
# or
yarn add @izenzo/sdk
# or
pnpm add @izenzo/sdk
```

## Quick Start

```typescript
import { IzenzoClient } from '@izenzo/sdk';

const client = new IzenzoClient({
  apiKey: 'sk_your_api_key',
  baseUrl: 'https://api.trade.izenzo.co.za/functions/v1', // optional, this is the default
});

// Create a match
const match = await client.matches.create({
  buyer:     { id: 'B001', name: 'Acme Corp' },
  seller:    { id: 'S001', name: 'Supplier Inc' },
  commodity: 'Steel Coils',
  quantity:  { amount: 100, unit: 'tonnes' },
  price:     { amount: 50000, currency: 'USD' },
});

console.log(match.id, match.hash);
```

## Resources

| Resource              | Description |
|-----------------------|-------------|
| `client.matches`      | Create, get, list, and confirm trade matches |
| `client.signals`      | Submit buy/sell signals, browse options, select |
| `client.entities`     | Create and screen legal entities (KYC/KYB) |
| `client.authority`    | UBO links and Authority-to-Bind records |
| `client.tradeApprovals` | Issue and revoke trade approvals |
| `client.pods`         | Proof-of-Delivery milestones and breach tracking |
| `client.complianceCases` | Open, list, and decide compliance cases |
| `client.apiKeys`      | Create, list, revoke API keys (requires JWT) |
| `client.webhooks`     | Register and manage webhook endpoints |
| `client.health`       | System health check |

## Matches

```typescript
// Create
const match = await client.matches.create({ buyer, seller, commodity, quantity, price });

// Get by ID
const existing = await client.matches.get('match_id');

// Confirm intent (non-binding acknowledgement)
const confirmed = await client.matches.confirmIntent('match_id');

// List with filters
const { items, totalCount } = await client.matches.list({
  status: 'matched',
  commodity: 'Steel',
  limit: 20,
  offset: 0,
});
```

## Signals (Discovery)

```typescript
// Submit a buy signal
const signal = await client.signals.create({
  product: 'Pharmaceutical API',
  quantity: 500,
  unit: 'kg',
  location: 'Johannesburg',
  budget: 100000,
  currency: 'ZAR',
});

// Check status
const status = await client.signals.getStatus(signal.id);

// Get signal with matched options
const withOptions = await client.signals.get(signal.id);

// Select an option → creates a match
const selection = await client.signals.selectOption(signal.id, 'option_id');
```

## Entities (V3 — KYC/KYB)

```typescript
// Register a legal entity
const entity = await client.entities.create({
  legal_name: 'Acme Trading (Pty) Ltd',
  entity_type: 'company',
  jurisdiction_code: 'ZA',
  registration_number: '2024/123456/07',
});

// Screen against sanctions lists
const screenResult = await client.entities.screen(entity.id);
```

## Authority-to-Bind & UBO

```typescript
// Link a UBO (Ultimate Beneficial Owner)
const ubo = await client.authority.createUbo(personEntityId, companyEntityId, 35);

// Create an ATB record
const atb = await client.authority.createAtb(personEntityId, companyEntityId, 'resolution');

// Check governance gates
const gates = await client.authority.checkGates(personEntityId, companyEntityId);
// → { ubo_passed: true, atb_passed: true, total_ownership: 35, ... }
```

## Error Handling

```typescript
import { IzenzoApiError } from '@izenzo/sdk';

try {
  await client.matches.get('nonexistent');
} catch (error) {
  if (error instanceof IzenzoApiError) {
    console.error(error.code);       // e.g. 'NOT_FOUND'
    console.error(error.statusCode); // e.g. 404
    console.error(error.requestId);  // for support tickets
  }
}
```

## Configuration

```typescript
const client = new IzenzoClient({
  apiKey:  'sk_...',
  baseUrl: 'https://api.trade.izenzo.co.za/functions/v1', // default
  timeout: 30000, // ms, default
});

// Or shorthand with just the API key (uses defaults)
const client = new IzenzoClient('sk_...');

// Update key at runtime
client.setApiKey('sk_new_key');
```

## Requirements

- Node.js ≥ 18 (uses native `fetch`)
- Works in browsers, Deno, Bun, and Cloudflare Workers

## License

MIT © [Izenzo (Pty) Ltd](https://izenzo.co.za)
