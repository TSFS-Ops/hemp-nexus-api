/**
 * Webhook Management Examples for Trade.Izenzo API
 * 
 * This file demonstrates how to:
 * 1. Create webhook endpoints
 * 2. List and manage webhooks
 * 3. Verify webhook signatures
 * 4. Handle webhook events
 */

const BASE_URL = "https://your-api-domain.com"; // Replace with actual API URL
const crypto = require('crypto');

/**
 * Create a webhook endpoint
 */
async function createWebhook(apiKey) {
  const response = await fetch(`${BASE_URL}/webhooks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      url: "https://your-domain.com/webhook",
      events: ["signal.created", "match.created", "option.selected"],
      // Optional: provide your own secret (min 16 chars), or let it be auto-generated
      secret: "your_secure_webhook_secret_min_16_chars"
    }),
  });

  if (!response.ok) {
    console.error("Failed to create webhook:", await response.text());
    return null;
  }

  const data = await response.json();
  console.log("Webhook created:", data);
  
  // IMPORTANT: Save the secret if auto-generated - you won't see it again!
  if (data.secret) {
    console.log("⚠️ SAVE THIS SECRET:", data.secret);
  }
  
  return data;
}

/**
 * List all webhooks
 */
async function listWebhooks(apiKey) {
  const response = await fetch(`${BASE_URL}/webhooks`, {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  if (!response.ok) {
    console.error("Failed to list webhooks:", await response.text());
    return null;
  }

  const data = await response.json();
  console.log("Webhooks:", data);
  return data;
}

/**
 * Update webhook endpoint
 */
async function updateWebhook(apiKey, webhookId) {
  const response = await fetch(`${BASE_URL}/webhooks/${webhookId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      events: ["match.created", "intent.confirmed"],
      status: "active"
    }),
  });

  if (!response.ok) {
    console.error("Failed to update webhook:", await response.text());
    return null;
  }

  const data = await response.json();
  console.log("Webhook updated:", data);
  return data;
}

/**
 * Delete webhook endpoint
 */
async function deleteWebhook(apiKey, webhookId) {
  const response = await fetch(`${BASE_URL}/webhooks/${webhookId}`, {
    method: "DELETE",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  if (!response.ok) {
    console.error("Failed to delete webhook:", await response.text());
    return false;
  }

  console.log("Webhook deleted successfully");
  return true;
}

/**
 * Verify webhook signature
 * Use this in your webhook handler to ensure requests are from Trade.Izenzo
 */
function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');
  
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Example webhook handler using Express.js
 */
function setupWebhookHandler() {
  const express = require('express');
  const app = express();
  
  const WEBHOOK_SECRET = "your_webhook_secret"; // The secret from webhook creation
  
  // IMPORTANT: Use express.raw() to get the raw body for signature verification
  app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const signature = req.headers['x-webhook-signature'];
    const event = req.headers['x-webhook-event'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const payload = req.body.toString();
    
    // Verify signature
    if (!verifyWebhookSignature(payload, signature, WEBHOOK_SECRET)) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Parse the verified payload
    const data = JSON.parse(payload);
    console.log(`Received event: ${event} at ${timestamp}`);
    
    // Respond quickly (within 5 seconds)
    res.status(200).json({ received: true });
    
    // Process the webhook asynchronously
    processWebhook(event, data).catch(console.error);
  });
  
  app.listen(3000, () => {
    console.log('Webhook handler listening on port 3000');
  });
}

/**
 * Process different webhook events
 */
async function processWebhook(event, data) {
  console.log(`Processing ${event}:`, JSON.stringify(data, null, 2));
  
  switch (event) {
    case 'signal.created':
      // Handle new signal
      console.log(`New signal created: ${data.data.signalId}`);
      console.log(`Product: ${data.data.product}`);
      // Your business logic here
      break;
      
    case 'option.selected':
      // Handle option selection
      console.log(`Option selected for signal: ${data.data.signalId}`);
      console.log(`Source: ${data.data.dataSourceType}`);
      // Your business logic here
      break;
      
    case 'match.created':
      // Handle new match
      console.log(`New match created: ${data.data.matchId}`);
      console.log(`Commodity: ${data.data.commodity}`);
      console.log(`Buyer: ${data.data.buyer.name}`);
      console.log(`Seller: ${data.data.seller.name}`);
      // Your business logic here
      break;
      
    case 'match.settled':
    case 'intent.confirmed':
      // Handle intent confirmation (no legal obligation - signals serious interest)
      console.log(`Intent confirmed for match: ${data.data.matchId}`);
      console.log(`Confirmed at: ${data.data.settledAt}`);
      console.log(`Note: This signals interest only - no payment or legal obligation created`);
      // Your business logic here
      break;
      
    default:
      console.log(`Unknown event: ${event}`);
  }
}

/**
 * Complete webhook setup flow
 */
async function setupWebhooks(apiKey) {
  console.log("Setting up webhooks...");
  
  // 1. Create webhook endpoint
  const webhook = await createWebhook(apiKey);
  if (!webhook) return;
  
  console.log(`\nWebhook ID: ${webhook.id}`);
  console.log(`Webhook URL: ${webhook.url}`);
  console.log(`Events: ${webhook.events.join(', ')}`);
  
  // 2. List all webhooks
  await listWebhooks(apiKey);
  
  // 3. Optional: Update webhook
  // await updateWebhook(apiKey, webhook.id);
  
  console.log("\n✅ Webhook setup complete!");
  console.log("\nNext steps:");
  console.log("1. Implement your webhook handler (see setupWebhookHandler())");
  console.log("2. Deploy your handler to a publicly accessible URL");
  console.log("3. Update the webhook URL if needed");
  console.log("4. Test by creating a signal or match");
}

// Export functions for use in other modules
module.exports = {
  createWebhook,
  listWebhooks,
  updateWebhook,
  deleteWebhook,
  verifyWebhookSignature,
  processWebhook,
  setupWebhooks,
  setupWebhookHandler,
};

// Run the setup if executed directly
if (require.main === module) {
  const API_KEY = process.env.API_KEY || "your_api_key_here";
  setupWebhooks(API_KEY);
}
