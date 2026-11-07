/**
 * Older MLC conversions publish their weight manifest as ndarray-cache.json; WebLLM 0.2.87 only
 * requests tensor-cache.json. This fetch wrapper retries the legacy name on a 404.
 */
type Fetch = typeof fetch;

export function withLegacyManifestFallback(fetchFn: Fetch): Fetch {
  return async (input, init) => {
    const response = await fetchFn(input, init);
    if (response.status !== 404) return response;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/\/tensor-cache\.json(\?|$)/.test(url)) return response;
    const legacy = await fetchFn(url.replace('tensor-cache.json', 'ndarray-cache.json'), init);
    return legacy.ok ? legacy : response;
  };
}
