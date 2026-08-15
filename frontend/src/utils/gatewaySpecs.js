export const DEFAULT_GEMINI_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-3.6-flash"
];

export const GATEWAY_INTEGRATIONS = {
  openai: {
    name: "OpenAI",
    endpoint: "/openai/v1/chat/completions",
    method: "POST",
    body: {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello from OptiAPI!" }]
    }
  },
  gemini: {
    name: "Gemini",
    endpoint: "/gemini/v1/models/{model}:generateContent",
    method: "POST",
    requiresModel: true,
    body: {
      contents: [{ parts: [{ text: "Hello from OptiAPI!" }] }]
    }
  },
  anthropic: {
    name: "Claude (Anthropic)",
    endpoint: "/anthropic/v1/messages",
    method: "POST",
    body: {
      model: "claude-3-sonnet-20240229",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello from OptiAPI!" }]
    }
  },
  stripe: {
    name: "Stripe Payments",
    endpoint: "/stripe/v1/charges",
    method: "POST",
    body: {
      amount: 2000,
      currency: "usd",
      source: "tok_visa"
    }
  },
  google_maps: {
    name: "Google Maps APIs",
    endpoint: "/google_maps/maps/api/geocode/json?address=1600+Amphitheatre+Parkway",
    method: "GET",
    body: null
  },
  twilio: {
    name: "Twilio Messaging",
    endpoint: "/twilio/2010-04-01/Accounts/AC123/Messages.json",
    method: "POST",
    body: {
      To: "+1234567890",
      From: "+0987654321",
      Body: "Hello from OptiAPI!"
    }
  },
  weather: {
    name: "Weather API",
    endpoint: "/weather/v1/current.json?q=London",
    method: "GET",
    body: null
  },
  custom: {
    name: "Custom REST Endpoints",
    endpoint: "/custom/api/v1/your-resource",
    method: "POST",
    body: {
      data: "your-payload"
    }
  }
};
