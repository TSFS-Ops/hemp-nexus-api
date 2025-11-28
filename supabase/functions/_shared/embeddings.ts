// Semantic embedding service for intelligent matching
// Uses Lovable AI for generating embeddings

interface EmbeddingResponse {
  embedding: number[];
  error?: string;
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return null;
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      console.error('Embedding API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}

// Calculate cosine similarity between two embeddings
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Generate searchable text from signal for embedding
export function signalToText(signal: any): string {
  const parts = [];
  
  if (signal.content.product || signal.content.what) {
    parts.push(signal.content.product || signal.content.what);
  }
  if (signal.content.commodity_type) {
    parts.push(signal.content.commodity_type);
  }
  if (signal.content.quantity || signal.content.how_much) {
    parts.push(`${signal.content.quantity || signal.content.how_much} ${signal.content.unit || ''}`);
  }
  if (signal.content.location || signal.content.where) {
    parts.push(signal.content.location || signal.content.where);
  }
  if (signal.content.quality_requirements) {
    parts.push(JSON.stringify(signal.content.quality_requirements));
  }
  
  return parts.filter(Boolean).join(' ');
}
