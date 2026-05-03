# Getting Started with Compliance Matching API

**Last Updated**: 2026-05-03 (USD-native pricing)

This guide will walk you through your first steps with the Compliance Matching API, from creating an account to making your first API call. No prior API experience required!

---

## 📖 Table of Contents

1. [What You'll Learn](#what-youll-learn)
2. [Prerequisites](#prerequisites)
3. [Understanding APIs (For Beginners)](#understanding-apis-for-beginners)
4. [Step-by-Step Setup](#step-by-step-setup)
5. [Your First API Call](#your-first-api-call)
6. [Understanding the Response](#understanding-the-response)
7. [Common Mistakes](#common-mistakes)
8. [Next Steps](#next-steps)

---

## 🎯 What You'll Learn

By the end of this guide, you'll be able to:

- ✅ Create and manage API keys
- ✅ Make your first API request
- ✅ Understand API responses
- ✅ Handle errors gracefully
- ✅ Know where to go for help

**Time Required**: 15-20 minutes

---

## 📋 Prerequisites

### What You Need
- ✅ A valid email address
- ✅ A text editor or development environment
- ✅ Basic command line knowledge (helpful but not required)

### What You DON'T Need
- ❌ Prior API experience
- ❌ Advanced programming skills
- ❌ Special software or tools

---

## 🌐 Understanding APIs (For Beginners)

### What Is an API?

**API** stands for **Application Programming Interface**. 

**In simple terms**: An API is like a waiter in a restaurant:
- **You** (the customer) want something from the kitchen
- **The waiter** (the API) takes your order to the kitchen
- **The kitchen** (our servers) prepares what you asked for
- **The waiter** brings back your food (the data you requested)

### Why Use an API?

APIs let different software systems talk to each other automatically. Instead of manually typing data between systems, APIs do it instantly.

**Real-world example**:
- **Without API**: You check a website for product availability, manually enter order in your system
- **With API**: Your system automatically checks availability and creates orders

### How APIs Work

1. **You send a request**: "I want to create a signal for 100 units of Product X"
2. **API processes it**: Validates your request, checks permissions
3. **You get a response**: "Signal created successfully, here's the ID and matched options"

**Analogy**: It's like sending a text message and getting a reply. But instead of people texting, it's computer systems.

---

## 🚀 Step-by-Step Setup

### Step 1: Create Your Account

**Why?** You need an account to get API keys and access the dashboard.

1. **Navigate to the signup page**
   - URL: Your platform's signup URL

2. **Fill in your details**
   ```
   Email: your.email@company.com
   Password: (minimum 8 characters)
   ```

3. **Important**: Choose a strong password
   - ✅ Good: `MyC0mpany2025!`
   - ❌ Bad: `password123`

4. **Check your email**
   - Look for "Verify Your Email" message
   - Click the verification link
   - **Why?** This proves you own the email and prevents spam accounts

5. **Account Creation Complete!**
   - You'll be redirected to the login page

**Troubleshooting**:
- **Email not received?** Check spam folder, wait 5 minutes
- **Link expired?** Request a new verification email
- **Password rejected?** Ensure it's at least 8 characters with mixed case

---

### Step 2: Log In and Explore the Dashboard

**Why?** The dashboard is your control center for managing API keys, viewing data, and testing.

1. **Log in** with your verified email and password

2. **First Login Experience**
   - You'll see a welcome message
   - An organisation is automatically created for you
   - Your role is set (admin if @izenzo.co.za email, buyer otherwise)

3. **Dashboard Overview**

   **What you'll see**:
   ```
   ┌─────────────────────────────────────┐
   │  📊 Dashboard                       │
   ├─────────────────────────────────────┤
   │  • API Keys   - Manage access       │
   │  • Testing    - Try the API         │
   │  • Analytics  - View usage stats    │
   │  • Audit Logs - See activity        │
   │  • Documentation - Read guides      │
   └─────────────────────────────────────┘
   ```

4. **Take a moment to explore**
   - Click through each tab
   - Don't worry about breaking anything-you're just looking!

---

### Step 3: Create Your First API Key

**Why?** API keys are how you authenticate (prove who you are) when making API calls.

**Analogy**: An API key is like a key card for a hotel room-it identifies you and grants access.

#### Understanding API Keys

**What is it?**
- A secret string that looks like: `sk_1a2b3c4d5e6f7g8h9i0j`
- The `sk_` prefix means "secret key"

**Security Note**: 
- ⚠️ Treat API keys like passwords
- ⚠️ Never share them publicly
- ⚠️ Never commit them to code repositories

#### Creating the Key

1. **Navigate to Dashboard → API Keys tab**

2. **Click "Create API Key" button**

3. **Fill in the form**:

   **Key Name** (Required)
   ```
   Example: "Production API Key"
   ```
   - **What it's for**: Helps you identify keys when you have multiple
   - **Tip**: Use descriptive names like "Production", "Testing", "Development"

   **Expiry Period** (Required)
   ```
   Options:
   • Never (key never expires)
   • 30 days
   • 90 days
   • 180 days
   • 365 days
   ```
   - **What it means**: When the key stops working
   - **Why it matters**: Security best practice to rotate keys
   - **Recommendation**: Start with "Never" for learning, use expiry in production

   **Scopes** (Required)
   ```
   What are scopes?
   Scopes control what the API key can do.
   It's like giving someone specific permissions.
   ```

   **Available Scopes**:
   - ☑️ `signals:read` - View signals
   - ☑️ `signals:write` - Create/modify signals
   - ☑️ `data-sources:read` - View data sources
   - ☑️ `data-sources:write` - Manage data sources
   - ☑️ `consents:read` - View consents
   - ☑️ `consents:write` - Manage consents
   - ☑️ `webhooks:read` - View webhooks
   - ☑️ `webhooks:write` - Manage webhooks

   **For getting started, select**:
   - ✅ `signals:write`
   - ✅ `signals:read`

   **Why these scopes?** 
   - These let you test the core functionality: creating and viewing signals
   - You can always create more keys with different permissions later

4. **Click "Create API Key"**

5. **CRITICAL: Copy Your Key NOW**

   ```
   ┌────────────────────────────────────────────┐
   │ ⚠️  Important: Save Your API Key           │
   ├────────────────────────────────────────────┤
   │ This is the only time you'll see this key: │
   │                                             │
   │ sk_1a2b3c4d5e6f7g8h9i0j                   │
   │                                             │
   │ Copy it now and store it securely!         │
   │ We can't recover it if you lose it.        │
   └────────────────────────────────────────────┘
   ```

6. **Store Your Key Securely**

   **Options**:
   
   **Option A: Environment Variable** (Recommended for developers)
   ```bash
   # In your .env file
   API_KEY=sk_1a2b3c4d5e6f7g8h9i0j
   ```

   **Option B: Password Manager**
   - Use 1Password, LastPass, or similar
   - Create a new entry called "API Key - YourCompany"

   **Option C: Secure Notes**
   - Store in an encrypted notes app
   - Never in plain text files

   **⛔ NEVER DO THIS**:
   - ❌ Don't hardcode in your application code
   - ❌ Don't commit to Git/GitHub
   - ❌ Don't share via email or chat
   - ❌ Don't post in public forums

---

### Step 4: Test Your Setup

**Why?** Before building anything, verify your API key works.

#### Method 1: Using the Dashboard (Easiest)

1. **Navigate to Dashboard → Testing tab**

2. **Paste your API key** in the provided field

3. **Click "Run Tests"**
   - These are automated smoke tests that verify your API setup is working correctly
   - **What are smoke tests?** Quick validation tests that check if core features work without errors

4. **You should see**:
   ```
   ✅ Create Match: PASSED
   ✅ Verify Match Hash: PASSED
   ✅ Verify Match Audit Log: PASSED
   ✅ Settle Match: PASSED (this only confirms intent, not a binding contract)
   ✅ Verify Settlement Audit Log: PASSED
   ```

5. **If any test fails**:
   - Check your API key is correct
   - Ensure you have the right scopes
   - Try creating a new key

#### Method 2: Using Command Line (For Developers)

**Prerequisites**: Install `curl` (usually pre-installed on Mac/Linux)

1. **Open your terminal**

2. **Test authentication**:
   ```bash
   curl https://api.izenzo.co.za/functions/v1/healthz \
     -H "X-API-Key: YOUR_API_KEY_HERE"
   ```

   **Replace** `YOUR_API_KEY_HERE` with your actual key

3. **Expected response**:
   ```json
   {
     "status": "ok",
     "timestamp": "2025-11-20T10:30:00Z"
   }
   ```

4. **If you see this**, your setup is working! 🎉

---

## 🔥 Your First API Call

Now let's create your first signal-a request to buy or sell something.

### Understanding Signals

**What is a signal?**
A signal expresses your intent to trade. Think of it as posting a want ad:

- **Buyer Signal**: "I want to buy 100 units of Product X"
- **Seller Signal**: "I have 50 units of Product Y to sell"

**What happens when you create a signal?**
1. System records your intent
2. Searches for matching opportunities
3. Returns relevant options
4. You can then select an option to create a match

### Creating a Buyer Signal

#### Using cURL (Command Line)

```bash
curl -X POST https://api.izenzo.co.za/functions/v1/signals \
  -H "X-API-Key: YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "product": "Medical Surgical Masks",
    "quantity": 10000,
    "unit": "units",
    "location": "Johannesburg",
    "deliveryWindow": {
      "start": "2025-12-01",
      "end": "2025-12-15"
    }
  }'
```

**Breaking down the request**:

**The URL**:
```
https://api.izenzo.co.za/functions/v1/signals
```
- This is the "address" of the API endpoint
- `/signals` means we're working with signals

**The Headers**:
```bash
-H "X-API-Key: YOUR_API_KEY_HERE"
```
- **What it does**: Proves you're authorised
- **YOUR_API_KEY_HERE**: Replace with your actual key

```bash
-H "Content-Type: application/json"
```
- **What it does**: Tells the API we're sending JSON data
- **JSON**: A format for structuring data (like XML but simpler)

**The Data** (`-d`):
```json
{
  "product": "Medical Surgical Masks",
  "quantity": 10000,
  "unit": "units",
  "location": "Johannesburg",
  "deliveryWindow": {
    "start": "2025-12-01",
    "end": "2025-12-15"
  }
}
```

**Field Explanations**:
- `product`: What you want (free text, be specific)
- `quantity`: How much (number)
- `unit`: What quantity means (units, boxes, kg, etc.)
- `location`: Where you want it (city, region, country)
- `deliveryWindow`: When you need it (optional)
  - `start`: Earliest acceptable date
  - `end`: Latest acceptable date

#### Using JavaScript

```javascript
// First, install node-fetch if needed: npm install node-fetch

const fetch = require('node-fetch');

async function createSignal() {
  const apiKey = process.env.API_KEY; // Store in environment variable
  
  const response = await fetch(
    'https://api.izenzo.co.za/functions/v1/signals',
    {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        product: 'Medical Surgical Masks',
        quantity: 10000,
        unit: 'units',
        location: 'Johannesburg',
        deliveryWindow: {
          start: '2025-12-01',
          end: '2025-12-15'
        }
      })
    }
  );

  const data = await response.json();
  
  if (response.ok) {
    console.log('Signal created successfully!');
    console.log('Signal ID:', data.signal.id);
    console.log('Matched options:', data.options.length);
  } else {
    console.error('Error:', data.message);
  }
}

createSignal();
```

#### Using Python

```python
import requests
import os
import json

api_key = os.environ.get('API_KEY')  # Store in environment variable

url = 'https://api.izenzo.co.za/functions/v1/signals'

headers = {
    'X-API-Key': api_key,
    'Content-Type': 'application/json'
}

data = {
    'product': 'Medical Surgical Masks',
    'quantity': 10000,
    'unit': 'units',
    'location': 'Johannesburg',
    'deliveryWindow': {
        'start': '2025-12-01',
        'end': '2025-12-15'
    }
}

response = requests.post(url, headers=headers, json=data)

if response.status_code == 200:
    result = response.json()
    print('Signal created successfully!')
    print(f"Signal ID: {result['signal']['id']}")
    print(f"Matched options: {len(result['options'])}")
else:
    error = response.json()
    print(f"Error: {error['message']}")
```

---

## 📊 Understanding the Response

### Successful Response

When your signal is created successfully, you'll get a response like this:

```json
{
  "signal": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "type": "buyer",
    "status": "active",
    "created_at": "2025-11-20T10:30:00.000Z",
    "content": {
      "product": "Medical Surgical Masks",
      "quantity": 10000,
      "unit": "units",
      "location": "Johannesburg",
      "deliveryWindow": {
        "start": "2025-12-01",
        "end": "2025-12-15"
      }
    }
  },
  "options": [
    {
      "id": "opt-1",
      "what": "Medical Surgical Masks - Type IIR",
      "how_much": 12000,
      "unit": "units",
      "price": 15000,
      "currency": "USD",
      "where_location": "Pretoria",
      "when_available": "2025-11-25",
      "score": 95,
      "source_link": "https://supplier.example.com/product/123"
    },
    {
      "id": "opt-2",
      "what": "Medical Surgical Masks - Standard",
      "how_much": 10000,
      "unit": "units",
      "price": 12000,
      "currency": "USD",
      "where_location": "Johannesburg",
      "when_available": "2025-12-01",
      "score": 88,
      "source_link": "https://supplier2.example.com/product/456"
    }
  ],
  "message": "Signal created and 2 options found"
}
```

### Breaking Down the Response

#### The Signal Object

```json
"signal": {
  "id": "123e4567-e89b-12d3-a456-426614174000",
  ...
}
```

**What is this?**
- A unique identifier for your signal
- **UUID format**: Universally Unique Identifier
- **Save this ID**: You'll need it to query status or select options

**Why it matters**:
- Reference this signal in future API calls
- Track the signal in your system
- Link back to your internal records

#### The Options Array

```json
"options": [ ... ]
```

**What are options?**
- Potential matches for your signal
- Each option represents a possible trade partner
- Sorted by relevance score (highest first)

**Option Fields Explained**:

- `id`: Unique identifier for this option
- `what`: Detailed product description
- `how_much`: Quantity available
- `unit`: Measurement unit
- `price`: Total price (or per-unit, check carefully)
- `currency`: ISO 4217 currency code. The platform is USD-native — credits and platform billing are always USD. Trade option prices may be quoted in other currencies (USD, EUR, GBP, ZAR, etc.) depending on the supplier.
- `where_location`: Where the product is located
- `when_available`: When it can be delivered
- `score`: Relevance score (0-100, higher is better)
- `source_link`: URL to more information

#### The Score

```json
"score": 95
```

**What does the score mean?**
- **90-100**: Excellent match
  - Product closely matches your request
  - Quantity is right
  - Location is close
  - Timing aligns well

- **70-89**: Good match
  - Minor differences (e.g., slightly different location)
  - Acceptable alternatives

- **50-69**: Partial match
  - Some key differences
  - May require negotiation

- **Below 50**: Weak match
  - Significant differences
  - Consider carefully before proceeding

**How scores are calculated**:
1. Product name similarity (40%)
2. Quantity match (20%)
3. Location proximity (20%)
4. Delivery timing (10%)
5. Supplier reputation (10%)

---

## 🚨 Common Mistakes and How to Fix Them

### Mistake 1: "Unauthorised" Error

**Error Message**:
```json
{
  "code": "UNAUTHORIZED",
  "message": "Invalid or missing API key"
}
```

**Why this happens**:
- API key is incorrect
- API key has been revoked
- API key expired
- Header format is wrong

**How to fix**:

1. **Check the header format**:
   ```bash
   # ✅ Correct
   Authorization: Bearer sk_your_key_here
   
   # ❌ Wrong (missing "Bearer")
   Authorization: sk_your_key_here
   
   # ❌ Wrong (using "X-API-Key")
   X-API-Key: sk_your_key_here
   ```

2. **Verify your key**:
   - Log into the dashboard
   - Go to API Keys tab
   - Check if the key status is "active"
   - If not, create a new key

3. **Check for extra spaces**:
   ```bash
   # ❌ Wrong (space after Bearer)
   Authorization: Bearer  sk_your_key_here
   #                    ↑ extra space
   
   # ✅ Correct (single space)
   Authorization: Bearer sk_your_key_here
   #                    ↑ single space
   ```

---

### Mistake 2: "Forbidden" Error

**Error Message**:
```json
{
  "code": "FORBIDDEN",
  "message": "Insufficient permissions for this operation"
}
```

**Why this happens**:
- Your API key doesn't have the required scope

**Example**:
- You're trying to create a signal
- But your key only has `signals:read` scope
- You need `signals:write` scope

**How to fix**:

1. **Check required scopes** in the API documentation

2. **Update your API key**:
   - Go to Dashboard → API Keys
   - Create a new key with the correct scopes
   - Or revoke the old key and create a new one

**Scope requirements by endpoint**:
- Create signal: `signals:write`
- View signals: `signals:read`
- Create match: `match:write`
- View matches: `match:read`

---

### Mistake 3: Validation Errors

**Error Message**:
```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid request data",
  "details": {
    "field": "quantity",
    "issue": "must be a positive number"
  }
}
```

**Why this happens**:
- Required fields are missing
- Fields have invalid values
- Data types are wrong

**Common validation issues**:

1. **Missing required fields**:
   ```json
   // ❌ Wrong (missing unit)
   {
     "product": "Masks",
     "quantity": 100
   }
   
   // ✅ Correct
   {
     "product": "Masks",
     "quantity": 100,
     "unit": "boxes"
   }
   ```

2. **Invalid data types**:
   ```json
   // ❌ Wrong (quantity is a string)
   {
     "quantity": "100"
   }
   
   // ✅ Correct (quantity is a number)
   {
     "quantity": 100
   }
   ```

3. **Invalid values**:
   ```json
   // ❌ Wrong (negative quantity)
   {
     "quantity": -100
   }
   
   // ✅ Correct (positive quantity)
   {
     "quantity": 100
   }
   ```

**How to fix**:
- Read the error message carefully
- Check the `details` field for specifics
- Refer to the API documentation for field requirements

---

### Mistake 4: Rate Limiting

**Error Message**:
```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded for endpoint: signals",
  "details": {
    "retryAfter": 60,
    "limit": 100
  }
}
```

**Why this happens**:
- You've made too many requests in a short time
- Default limit: 100 requests per minute for signals

**How to fix**:

1. **Wait and retry**:
   - Check the `retryAfter` field (in seconds)
   - Wait that long before trying again

2. **Implement exponential backoff**:
   ```javascript
   async function makeRequestWithRetry(url, options, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       const response = await fetch(url, options);
       
       if (response.status === 429) {
         const retryAfter = response.headers.get('Retry-After') || 60;
         console.log(`Rate limited. Waiting ${retryAfter} seconds...`);
         await sleep(retryAfter * 1000);
         continue;
       }
       
       return response;
     }
     throw new Error('Max retries exceeded');
   }
   ```

3. **Reduce request frequency**:
   - Batch requests when possible
   - Add delays between requests
   - Cache responses to avoid duplicate calls

---

### Mistake 5: JSON Parsing Errors

**Error Message**:
```json
{
  "code": "INVALID_JSON",
  "message": "Request body is not valid JSON"
}
```

**Why this happens**:
- Malformed JSON in request body
- Missing quotes, commas, or brackets

**Common JSON mistakes**:

```json
// ❌ Wrong (missing comma)
{
  "product": "Masks"
  "quantity": 100
}

// ✅ Correct
{
  "product": "Masks",
  "quantity": 100
}
```

```json
// ❌ Wrong (trailing comma)
{
  "product": "Masks",
  "quantity": 100,
}

// ✅ Correct (no trailing comma)
{
  "product": "Masks",
  "quantity": 100
}
```

**How to fix**:
1. **Use a JSON validator**: jsonlint.com
2. **Use proper tools**: Modern code editors highlight JSON errors
3. **Test with simple requests first**: Start with minimal data

---

## 🎯 Next Steps

Congratulations! You've successfully:
- ✅ Created your account
- ✅ Generated an API key
- ✅ Made your first API call
- ✅ Understood the response

### What to Learn Next

#### Option 1: Explore More Features
- **[Webhooks](./webhooks.md)**: Get notified when events happen
- **[Matches](./api-reference.md#matches)**: Record trade agreements
- **[Analytics](./product-guide.md#analytics)**: Track your usage

#### Option 2: Build Your Integration
- **[API Reference](./api-reference.md)**: Complete endpoint documentation
- **[Code Examples](../examples/)**: Real integration examples
- **[Best Practices](./api-reference.md#best-practices)**: Security and performance tips

#### Option 3: Learn Advanced Topics
- **[Authentication Scopes](./api-reference.md#scopes)**: Fine-grained permissions
- **[Error Handling](./api-reference.md#error-handling)**: Robust applications
- **[Rate Limiting](./api-reference.md#rate-limiting)**: Optimize performance

### Practice Exercises

1. **Create Different Signal Types**
   - Try a seller signal
   - Add optional fields (delivery windows, quality requirements)
   - Experiment with different products

2. **Error Handling**
   - Deliberately make mistakes to see error messages
   - Practice fixing validation errors
   - Learn to interpret error responses

3. **View Your Data**
   - Use the dashboard to view created signals
   - Check the audit logs
   - Review analytics

### Getting Help

**Stuck?** Here's where to get help:

1. **Documentation**: Check the relevant docs section
2. **Dashboard Testing Tab**: Try the interactive testers
3. **Code Examples**: Review the `/examples` directory
4. **Support**: Email support@izenzo.co.za

### Pro Tips

1. **Start Small**: Don't try to build everything at once
2. **Test First**: Use the dashboard testers before writing code
3. **Version Control**: Track your API integration code in Git
4. **Error Logging**: Log all API errors for debugging
5. **Monitor Usage**: Check analytics regularly

---

## 📚 Quick Reference

### Essential URLs
- **Base URL**: `https://api.izenzo.co.za/functions/v1`
- **Health Check**: `/healthz`
- **Create Signal**: `/signals` (POST)
- **Create Match**: `/match` (POST)

### Essential Headers
```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### Essential HTTP Methods
- **GET**: Retrieve data
- **POST**: Create new data
- **PATCH**: Update existing data
- **DELETE**: Remove data

### Essential Status Codes
- **200**: Success
- **400**: Bad request (check your data)
- **401**: Unauthorised (check your API key)
- **403**: Forbidden (check your scopes)
- **429**: Rate limited (wait and retry)
- **500**: Server error (contact support)

---

