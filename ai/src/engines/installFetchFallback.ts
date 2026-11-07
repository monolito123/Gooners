/** Imported before WebLLM in its worker so every weight request goes through the fallback. */
import { withLegacyManifestFallback } from './legacyManifest.ts';

self.fetch = withLegacyManifestFallback(self.fetch.bind(self));
