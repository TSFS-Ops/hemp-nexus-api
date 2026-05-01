// Temporary env probe — delete after diagnostics.
Deno.test('env probe: list available SUPABASE_* keys', () => {
  const keys: string[] = [];
  for (const k of Object.keys(Deno.env.toObject())) {
    if (k.toUpperCase().includes('SUPABASE') || k.toUpperCase().includes('SERVICE')) {
      keys.push(k);
    }
  }
  console.log('AVAILABLE:', JSON.stringify(keys.sort()));
});
