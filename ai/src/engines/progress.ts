/** Parses WebLLM's human-readable init reports into structured progress. */
import type { LoadPhase } from './textTypes.ts';

export interface ParsedReport {
  phase: LoadPhase;
  fraction: number;
  loadedMB?: number;
  totalMB?: number;
}

const num = String.raw`(\d+(?:\.\d+)?)`;
const FETCH = new RegExp(String.raw`Fetching param cache\[(\d+)\/(\d+)\]:\s*${num}\s*MB fetched\.\s*${num}%`, 'i');
const CACHE = new RegExp(String.raw`Loading model from cache\[(\d+)\/(\d+)\]:\s*${num}\s*MB loaded\.\s*${num}%`, 'i');
const SHADERS = /Loading GPU shader modules\[(\d+)\/(\d+)\]/i;

export function parseWebLLMReport(report: { progress: number; text: string }): ParsedReport {
  const text = report.text ?? '';
  let m = text.match(FETCH) ?? text.match(CACHE);
  if (m) {
    const loadedMB = Number(m[3]);
    const pct = Number(m[4]);
    const phase: LoadPhase = /Fetching/i.test(m[0]) ? 'download' : 'cache';
    return {
      phase,
      fraction: Math.min(1, pct / 100),
      loadedMB,
      totalMB: pct > 0 ? loadedMB / (pct / 100) : undefined,
    };
  }
  m = text.match(SHADERS);
  if (m) return { phase: 'compile', fraction: Number(m[2]) ? Number(m[1]) / Number(m[2]) : 0 };
  if (/Finish loading/i.test(text)) return { phase: 'ready', fraction: 1 };
  return { phase: 'init', fraction: Number.isFinite(report.progress) ? report.progress : 0 };
}
