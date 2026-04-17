/**
 * Commodity Taxonomy - Curated product list for African trade.
 *
 * Designed for the Izenzo platform's core trading corridors.
 * Each entry carries an optional HS code prefix for future
 * customs/regulatory integration. Categories are UI-only groupings.
 *
 * Extensibility: add entries here; the CommoditySelect component
 * picks them up automatically. No DB migration required.
 */

export interface CommodityEntry {
  /** Display label shown in the selector */
  label: string;
  /** Normalised key used for matching and deduplication (lowercase, no spaces) */
  key: string;
  /** UI grouping */
  category: CommodityCategory;
  /** HS code prefix (2 to 6 digits). Informational for now. */
  hsCode?: string;
}

export type CommodityCategory =
  | "Grains & Oilseeds"
  | "Soft Commodities"
  | "Metals & Minerals"
  | "Energy"
  | "Chemicals & Fertilisers"
  | "Livestock & Animal Products"
  | "Building Materials"
  | "Pharmaceuticals & Health";

const CATEGORIES_ORDER: CommodityCategory[] = [
  "Grains & Oilseeds",
  "Soft Commodities",
  "Metals & Minerals",
  "Energy",
  "Chemicals & Fertilisers",
  "Livestock & Animal Products",
  "Building Materials",
  "Pharmaceuticals & Health",
];

const COMMODITIES: CommodityEntry[] = [
  // ── Grains & Oilseeds ──
  { label: "Soybeans", key: "soybeans", category: "Grains & Oilseeds", hsCode: "1201" },
  { label: "Soybeans (Non-GMO Food-Grade)", key: "soybeans-non-gmo-food-grade", category: "Grains & Oilseeds", hsCode: "1201" },
  { label: "Soybean Meal", key: "soybean-meal", category: "Grains & Oilseeds", hsCode: "2304" },
  { label: "Soybean Oil", key: "soybean-oil", category: "Grains & Oilseeds", hsCode: "1507" },
  { label: "Yellow Maize", key: "yellow-maize", category: "Grains & Oilseeds", hsCode: "1005" },
  { label: "White Maize", key: "white-maize", category: "Grains & Oilseeds", hsCode: "1005" },
  { label: "Wheat", key: "wheat", category: "Grains & Oilseeds", hsCode: "1001" },
  { label: "Rice", key: "rice", category: "Grains & Oilseeds", hsCode: "1006" },
  { label: "Barley", key: "barley", category: "Grains & Oilseeds", hsCode: "1003" },
  { label: "Sorghum", key: "sorghum", category: "Grains & Oilseeds", hsCode: "1007" },
  { label: "Sunflower Seeds", key: "sunflower-seeds", category: "Grains & Oilseeds", hsCode: "1206" },
  { label: "Sunflower Oil", key: "sunflower-oil", category: "Grains & Oilseeds", hsCode: "1512" },
  { label: "Canola / Rapeseed", key: "canola", category: "Grains & Oilseeds", hsCode: "1205" },
  { label: "Groundnuts (Peanuts)", key: "groundnuts", category: "Grains & Oilseeds", hsCode: "1202" },
  { label: "Sesame Seeds", key: "sesame-seeds", category: "Grains & Oilseeds", hsCode: "1207" },
  { label: "Millet", key: "millet", category: "Grains & Oilseeds", hsCode: "1008" },

  // ── Soft Commodities ──
  { label: "Raw Sugar", key: "raw-sugar", category: "Soft Commodities", hsCode: "1701" },
  { label: "Refined Sugar", key: "refined-sugar", category: "Soft Commodities", hsCode: "1701" },
  { label: "Coffee (Green Beans)", key: "coffee-green", category: "Soft Commodities", hsCode: "0901" },
  { label: "Coffee (Roasted)", key: "coffee-roasted", category: "Soft Commodities", hsCode: "0901" },
  { label: "Cocoa Beans", key: "cocoa-beans", category: "Soft Commodities", hsCode: "1801" },
  { label: "Tea", key: "tea", category: "Soft Commodities", hsCode: "0902" },
  { label: "Cotton Lint", key: "cotton-lint", category: "Soft Commodities", hsCode: "5201" },
  { label: "Tobacco (Unmanufactured)", key: "tobacco", category: "Soft Commodities", hsCode: "2401" },
  { label: "Cashew Nuts", key: "cashew-nuts", category: "Soft Commodities", hsCode: "0801" },
  { label: "Macadamia Nuts", key: "macadamia-nuts", category: "Soft Commodities", hsCode: "0802" },
  { label: "Citrus Fruit", key: "citrus-fruit", category: "Soft Commodities", hsCode: "0805" },
  { label: "Avocados", key: "avocados", category: "Soft Commodities", hsCode: "0804" },
  { label: "Palm Oil", key: "palm-oil", category: "Soft Commodities", hsCode: "1511" },
  { label: "Rubber (Natural)", key: "rubber-natural", category: "Soft Commodities", hsCode: "4001" },

  // ── Metals & Minerals ──
  { label: "Copper Cathode", key: "copper-cathode", category: "Metals & Minerals", hsCode: "7403" },
  { label: "Copper Concentrate", key: "copper-concentrate", category: "Metals & Minerals", hsCode: "2603" },
  { label: "Gold (Bullion)", key: "gold-bullion", category: "Metals & Minerals", hsCode: "7108" },
  { label: "Platinum", key: "platinum", category: "Metals & Minerals", hsCode: "7110" },
  { label: "Iron Ore", key: "iron-ore", category: "Metals & Minerals", hsCode: "2601" },
  { label: "Manganese Ore", key: "manganese-ore", category: "Metals & Minerals", hsCode: "2602" },
  { label: "Chrome Ore", key: "chrome-ore", category: "Metals & Minerals", hsCode: "2610" },
  { label: "Cobalt", key: "cobalt", category: "Metals & Minerals", hsCode: "8105" },
  { label: "Lithium (Spodumene)", key: "lithium-spodumene", category: "Metals & Minerals", hsCode: "2530" },
  { label: "Zinc", key: "zinc", category: "Metals & Minerals", hsCode: "7901" },
  { label: "Aluminium Ingots", key: "aluminium-ingots", category: "Metals & Minerals", hsCode: "7601" },
  { label: "Tin", key: "tin", category: "Metals & Minerals", hsCode: "8001" },
  { label: "Diamonds (Rough)", key: "diamonds-rough", category: "Metals & Minerals", hsCode: "7102" },
  { label: "Tantalite", key: "tantalite", category: "Metals & Minerals", hsCode: "2615" },

  // ── Energy ──
  { label: "Crude Oil", key: "crude-oil", category: "Energy", hsCode: "2709" },
  { label: "Diesel (ULSD)", key: "diesel-ulsd", category: "Energy", hsCode: "2710" },
  { label: "Petrol / Gasoline", key: "petrol", category: "Energy", hsCode: "2710" },
  { label: "Jet Fuel (Jet A-1)", key: "jet-fuel", category: "Energy", hsCode: "2710" },
  { label: "LPG", key: "lpg", category: "Energy", hsCode: "2711" },
  { label: "LNG", key: "lng", category: "Energy", hsCode: "2711" },
  { label: "Thermal Coal", key: "thermal-coal", category: "Energy", hsCode: "2701" },
  { label: "Metallurgical Coal", key: "met-coal", category: "Energy", hsCode: "2701" },

  // ── Chemicals & Fertilisers ──
  { label: "Urea", key: "urea", category: "Chemicals & Fertilisers", hsCode: "3102" },
  { label: "DAP (Diammonium Phosphate)", key: "dap", category: "Chemicals & Fertilisers", hsCode: "3105" },
  { label: "MAP (Monoammonium Phosphate)", key: "map", category: "Chemicals & Fertilisers", hsCode: "3105" },
  { label: "Potash (MOP)", key: "potash-mop", category: "Chemicals & Fertilisers", hsCode: "3104" },
  { label: "Ammonium Nitrate", key: "ammonium-nitrate", category: "Chemicals & Fertilisers", hsCode: "3102" },
  { label: "Sulphur", key: "sulphur", category: "Chemicals & Fertilisers", hsCode: "2503" },
  { label: "Phosphoric Acid", key: "phosphoric-acid", category: "Chemicals & Fertilisers", hsCode: "2809" },

  // ── Livestock & Animal Products ──
  { label: "Beef (Frozen)", key: "beef-frozen", category: "Livestock & Animal Products", hsCode: "0202" },
  { label: "Beef (Chilled)", key: "beef-chilled", category: "Livestock & Animal Products", hsCode: "0201" },
  { label: "Poultry (Frozen Chicken)", key: "poultry-frozen", category: "Livestock & Animal Products", hsCode: "0207" },
  { label: "Fish (Frozen)", key: "fish-frozen", category: "Livestock & Animal Products", hsCode: "0303" },
  { label: "Wool (Greasy)", key: "wool-greasy", category: "Livestock & Animal Products", hsCode: "5101" },
  { label: "Hides & Skins", key: "hides-skins", category: "Livestock & Animal Products", hsCode: "4101" },

  // ── Building Materials ──
  { label: "Cement (Portland)", key: "cement-portland", category: "Building Materials", hsCode: "2523" },
  { label: "Structural Steel", key: "structural-steel", category: "Building Materials", hsCode: "7216" },
  { label: "Timber (Sawn)", key: "timber-sawn", category: "Building Materials", hsCode: "4407" },

  // ── Pharmaceuticals & Health ──
  { label: "APIs (Active Pharmaceutical Ingredients)", key: "apis-pharma", category: "Pharmaceuticals & Health", hsCode: "3004" },
  { label: "Medical Devices (General)", key: "medical-devices", category: "Pharmaceuticals & Health", hsCode: "9018" },
  { label: "PPE (Personal Protective Equipment)", key: "ppe", category: "Pharmaceuticals & Health", hsCode: "6210" },
];

/** All commodities, sorted by category order then alphabetically within each category */
export function getAllCommodities(): CommodityEntry[] {
  return [...COMMODITIES].sort((a, b) => {
    const catDiff = CATEGORIES_ORDER.indexOf(a.category) - CATEGORIES_ORDER.indexOf(b.category);
    if (catDiff !== 0) return catDiff;
    return a.label.localeCompare(b.label);
  });
}

/** Categories in display order */
export function getCategories(): CommodityCategory[] {
  return [...CATEGORIES_ORDER];
}

/** Group commodities by category */
export function getCommoditiesByCategory(): Map<CommodityCategory, CommodityEntry[]> {
  const grouped = new Map<CommodityCategory, CommodityEntry[]>();
  for (const cat of CATEGORIES_ORDER) {
    grouped.set(cat, []);
  }
  for (const c of getAllCommodities()) {
    grouped.get(c.category)!.push(c);
  }
  return grouped;
}

/**
 * Search commodities by query string.
 * Matches against label, key, category, and HS code.
 */
export function searchCommodities(query: string): CommodityEntry[] {
  if (!query.trim()) return getAllCommodities();
  const q = query.toLowerCase().trim();
  return getAllCommodities().filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.key.includes(q) ||
      c.category.toLowerCase().includes(q) ||
      (c.hsCode && c.hsCode.startsWith(q))
  );
}

/**
 * Find a commodity by its normalised key.
 * Returns undefined if not in the curated list (free-text fallback).
 */
export function findCommodityByKey(key: string): CommodityEntry | undefined {
  return COMMODITIES.find((c) => c.key === key);
}

/**
 * Attempt to match free-text input to a curated commodity.
 * Returns the best match or null if no close match found.
 * Used to auto-resolve AI drafter output and legacy data.
 */
export function resolveCommodityFromText(text: string): CommodityEntry | null {
  if (!text.trim()) return null;
  const q = text.toLowerCase().trim();
  // Exact label match
  const exact = COMMODITIES.find((c) => c.label.toLowerCase() === q);
  if (exact) return exact;
  // Starts-with match
  const startsWith = COMMODITIES.find((c) => c.label.toLowerCase().startsWith(q));
  if (startsWith) return startsWith;
  // Contains match (first result)
  const contains = COMMODITIES.find((c) => c.label.toLowerCase().includes(q));
  return contains || null;
}
