// Multi-provider search orchestrator
// Searches across multiple providers in parallel for maximum coverage

interface SearchResult {
  title: string;
  url: string;
  description: string;
  source: string;
  location?: string;
  contact?: string;
  enriched?: any;
}

interface SearchProvider {
  name: string;
  search: (query: string) => Promise<SearchResult[]>;
}

// Brave Search provider
async function searchBrave(query: string): Promise<SearchResult[]> {
  const apiKey = Deno.env.get('SEARCH_API_KEY');
  if (!apiKey) return [];

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`,
      { headers: { 'X-Subscription-Token': apiKey } }
    );

    if (!response.ok) return [];
    
    const data = await response.json();
    return (data.web?.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      source: 'brave',
    }));
  } catch (error) {
    console.error('Brave search error:', error);
    return [];
  }
}

// DuckDuckGo Search (via API)
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
    );

    if (!response.ok) return [];
    
    const data = await response.json();
    return (data.RelatedTopics || [])
      .filter((t: any) => t.FirstURL)
      .slice(0, 10)
      .map((t: any) => ({
        title: t.Text?.split(' - ')[0] || '',
        url: t.FirstURL,
        description: t.Text || '',
        source: 'duckduckgo',
      }));
  } catch (error) {
    console.error('DuckDuckGo search error:', error);
    return [];
  }
}

// Google Custom Search (requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID)
async function searchGoogle(query: string): Promise<SearchResult[]> {
  const apiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
  const engineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
  
  if (!apiKey || !engineId) return [];

  try {
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(query)}&num=10`
    );

    if (!response.ok) return [];
    
    const data = await response.json();
    return (data.items || []).map((item: any) => ({
      title: item.title,
      url: item.link,
      description: item.snippet,
      source: 'google',
    }));
  } catch (error) {
    console.error('Google search error:', error);
    return [];
  }
}

// Bing Search
async function searchBing(query: string): Promise<SearchResult[]> {
  const apiKey = Deno.env.get('BING_SEARCH_API_KEY');
  if (!apiKey) return [];

  try {
    const response = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=20`,
      { headers: { 'Ocp-Apim-Subscription-Key': apiKey } }
    );

    if (!response.ok) return [];
    
    const data = await response.json();
    return (data.webPages?.value || []).map((r: any) => ({
      title: r.name,
      url: r.url,
      description: r.snippet,
      source: 'bing',
    }));
  } catch (error) {
    console.error('Bing search error:', error);
    return [];
  }
}

// Main multi-provider search function
export async function multiProviderSearch(
  queries: string[]
): Promise<SearchResult[]> {
  const providers: SearchProvider[] = [
    { name: 'brave', search: searchBrave },
    { name: 'duckduckgo', search: searchDuckDuckGo },
    { name: 'google', search: searchGoogle },
    { name: 'bing', search: searchBing },
  ];

  const allResults: SearchResult[] = [];
  
  // Execute all provider searches in parallel for each query
  for (const query of queries) {
    console.log(`Searching across ${providers.length} providers for: ${query}`);
    
    const providerPromises = providers.map(provider => 
      provider.search(query).catch(err => {
        console.error(`${provider.name} search failed:`, err);
        return [];
      })
    );
    
    const providerResults = await Promise.all(providerPromises);
    allResults.push(...providerResults.flat());
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = allResults.filter(result => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });

  console.log(`Multi-provider search: ${allResults.length} total, ${unique.length} unique results`);
  return unique;
}

// Enhanced query generation with semantic variations
export function generateEnhancedQueries(signal: any): string[] {
  const product = signal.content.product || signal.content.what || '';
  const location = signal.content.location || signal.content.where || '';
  const quantity = signal.content.quantity || signal.content.how_much || '';
  const type = signal.type;

  const queries: string[] = [];

  // Core queries
  queries.push(`${product} ${type === 'buyer' ? 'suppliers' : 'buyers'} ${location}`);
  queries.push(`wholesale ${product} ${type === 'buyer' ? 'distributors' : 'marketplace'}`);
  queries.push(`bulk ${product} ${quantity} ${type === 'buyer' ? 'manufacturers' : 'demand'}`);
  
  // Industry-specific
  queries.push(`licensed ${product} ${type === 'buyer' ? 'suppliers' : 'buyers'} international`);
  queries.push(`certified ${product} ${type === 'buyer' ? 'vendors' : 'procurement'}`);
  
  // Regulatory/compliance
  queries.push(`compliant ${product} ${type === 'buyer' ? 'source' : 'purchase'} ${location}`);
  queries.push(`regulated ${product} ${type === 'buyer' ? 'supplier' : 'buyer'} marketplace`);
  
  // Geographic expansion
  queries.push(`${product} ${type === 'buyer' ? 'suppliers' : 'buyers'} global`);
  queries.push(`international ${product} ${type === 'buyer' ? 'trade' : 'demand'}`);
  queries.push(`cross-border ${product} ${type === 'buyer' ? 'sourcing' : 'export'}`);

  return queries;
}
