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
  const baseOption = {
    what: signal.content.what || "Product",
    how_much: signal.content.how_much,
    unit: signal.content.unit || "kg",
    where_location: signal.content.where || "Unknown",
    when_available: "Available now",
    price: signal.content.price_budget ? signal.content.price_budget * (0.9 + Math.random() * 0.2) : 100,
    currency: "USD",
    quality_flags: { certified: true, tested: true },
    confidence_score: 0.8,
    source_link: `https://example.com/${dataSource.id}`,
  };

  return [baseOption];
}
