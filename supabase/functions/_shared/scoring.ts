// ML-Enhanced Option Scoring Algorithm
// Combines multiple signals: freshness, confidence, price, quality, semantic similarity, historical performance

import { cosineSimilarity } from './embeddings.ts';

interface ScoringWeights {
  freshness: number;
  confidence: number;
  price: number;
  quality: number;
  semantic: number;
  historical: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  freshness: 15,
  confidence: 25,
  price: 20,
  quality: 15,
  semantic: 15,
  historical: 10,
};

export async function scoreOption(
  option: any,
  signal: any,
  signalEmbedding?: number[] | null,
  historicalData?: any
): Promise<number> {
  let score = 0;

  // 1. Freshness (0-15 points): newer is better, but with decay
  const ageMs = Date.now() - new Date(option.freshness).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const freshnessScore = Math.max(0, DEFAULT_WEIGHTS.freshness * Math.exp(-ageDays / 30));
  score += freshnessScore;

  // 2. Confidence (0-25 points): from data source
  score += (option.confidence_score || 0) * DEFAULT_WEIGHTS.confidence;

  // 3. Price fit (0-20 points): closer to budget is better
  if (signal.content.price_budget && option.price) {
    const priceDiff = Math.abs(option.price - signal.content.price_budget) / signal.content.price_budget;
    const priceScore = Math.max(0, DEFAULT_WEIGHTS.price * (1 - priceDiff));
    score += priceScore;
  } else if (!signal.content.price_budget) {
    // No penalty if no budget specified
    score += DEFAULT_WEIGHTS.price * 0.5;
  }

  // 4. Quality match (0-15 points): regulatory compliance, certifications
  const qualityFlags = option.quality_flags || {};
  let qualityScore = 0;
  
  // High-value flags
  if (qualityFlags.sahpra_verified) qualityScore += 5;
  if (qualityFlags.certified) qualityScore += 3;
  if (qualityFlags.licensed) qualityScore += 3;
  
  // Additional flags worth less
  const otherFlags = Object.keys(qualityFlags).filter(
    k => !['sahpra_verified', 'certified', 'licensed', 'mock'].includes(k)
  ).length;
  qualityScore += Math.min(4, otherFlags * 1);
  
  score += Math.min(DEFAULT_WEIGHTS.quality, qualityScore);

  // 5. Semantic similarity (0-15 points): how well does option match signal intent?
  if (signalEmbedding && option.embedding) {
    try {
      const similarity = cosineSimilarity(signalEmbedding, option.embedding);
      score += similarity * DEFAULT_WEIGHTS.semantic;
    } catch (error) {
      console.error('Error calculating semantic similarity:', error);
    }
  }

  // 6. Historical performance (0-10 points): learn from past matches
  if (historicalData && option.data_source_id) {
    const sourcePerformance = historicalData[option.data_source_id];
    if (sourcePerformance) {
      // Calculate success rate
      const successRate = sourcePerformance.options_selected / 
        Math.max(1, sourcePerformance.options_returned);
      
      // Weight by number of attempts (more data = more reliable)
      const reliability = Math.min(1, sourcePerformance.options_returned / 10);
      
      score += successRate * reliability * DEFAULT_WEIGHTS.historical;
    }
  }

  return Math.min(100, Math.max(0, score));
}

// Legacy sync version for backward compatibility
export function scoreOptionSync(option: any, signal: any): number {
  let score = 0;

  // Freshness (0-15 points)
  const ageMs = Date.now() - new Date(option.freshness).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  score += Math.max(0, 15 * Math.exp(-ageDays / 30));

  // Confidence (0-25 points)
  score += (option.confidence_score || 0) * 25;

  // Price fit (0-20 points)
  if (signal.content.price_budget && option.price) {
    const priceDiff = Math.abs(option.price - signal.content.price_budget) / signal.content.price_budget;
    score += Math.max(0, 20 * (1 - priceDiff));
  }

  // Quality match (0-15 points)
  const qualityFlags = option.quality_flags || {};
  let qualityScore = 0;
  if (qualityFlags.sahpra_verified) qualityScore += 5;
  if (qualityFlags.certified) qualityScore += 3;
  if (qualityFlags.licensed) qualityScore += 3;
  qualityScore += Math.min(4, Object.keys(qualityFlags).filter(
    k => !['sahpra_verified', 'certified', 'licensed', 'mock'].includes(k)
  ).length);
  score += Math.min(15, qualityScore);

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
