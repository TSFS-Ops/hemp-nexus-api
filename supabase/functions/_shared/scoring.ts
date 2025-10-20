// Option scoring algorithm

export function scoreOption(option: any, signal: any): number {
  let score = 0;

  // Freshness (0-30 points): newer is better
  const ageMs = Date.now() - new Date(option.freshness).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  score += Math.max(0, 30 - ageDays * 3);

  // Confidence (0-30 points)
  score += (option.confidence_score || 0) * 30;

  // Price fit (0-20 points)
  if (signal.content.price_budget && option.price) {
    const priceDiff = Math.abs(option.price - signal.content.price_budget) / signal.content.price_budget;
    score += Math.max(0, 20 - priceDiff * 20);
  }

  // Quality match (0-20 points): simple flag check
  score += Object.keys(option.quality_flags || {}).length * 5;

  return Math.min(100, score);
}

export function generateMockOptions(signal: any, dataSource: any): any[] {
  const product = signal.content.product || signal.content.what || "Product";
  const quantity = signal.content.quantity || signal.content.how_much || 1000;
  const location = signal.content.location || signal.content.where || "South Africa";
  
  // Generate 3 mock options with varied SAHPRA status
  return [0, 1, 2].map((i) => ({
    what: product,
    how_much: quantity,
    unit: signal.content.unit || "kg",
    where_location: location,
    when_available: "Available now",
    price: 85000 + (i * 5000),
    currency: signal.content.currency || "ZAR",
    quality_flags: { 
      mock: true,
      sahpra_verified: i === 0, // First option has SAHPRA, others don't
      certified: i < 2 // First two are certified
    },
    confidence_score: 0.75 - (i * 0.1),
    source_link: `https://example.com/supplier-${i + 1}`,
    freshness: new Date().toISOString(),
  }));
}
