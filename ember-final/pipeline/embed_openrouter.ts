/** Explicit offline build: never generates document embeddings during a review request. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OpenRouterClient, EMBEDDING_MODEL, EMBEDDING_FORMAT_VERSION, formatEmbeddingDocument } from '../server/openrouter';

export interface EmbeddingChunk { chunkId: string; text: string; sectionHeader?: string | null }
export interface EmbeddingSource { corpusVersion: string; chunks: EmbeddingChunk[] }
export interface EmbeddingArtifact {
  corpusVersion: string;
  embeddingModel: typeof EMBEDDING_MODEL;
  embeddingDim: number;
  formatVersion: typeof EMBEDDING_FORMAT_VERSION;
  entries: Array<{ chunkId: string; contentHash: string; vector: number[] }>;
}
export interface BuildOptions { dimensions?: number; batchSize?: number; concurrency?: number }
export function embeddingContentHash(chunk: EmbeddingChunk): string {
  return createHash('sha256').update(formatEmbeddingDocument(chunk.text, chunk.sectionHeader)).digest('hex');
}
function boundedInteger(value: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${label} must be 1..${maximum}`);
  return value;
}
function validateSource(input: unknown): EmbeddingSource {
  if (!input || typeof input !== 'object') throw new Error('Embedding source must be an object');
  const source = input as Record<string, unknown>;
  if (typeof source.corpusVersion !== 'string' || !source.corpusVersion || !Array.isArray(source.chunks) || !source.chunks.length) throw new Error('Embedding source requires corpusVersion and chunks');
  const ids = new Set<string>();
  const chunks = source.chunks.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid embedding chunk');
    const chunk = item as Record<string, unknown>;
    if (typeof chunk.chunkId !== 'string' || !chunk.chunkId || typeof chunk.text !== 'string' || !chunk.text.trim()) throw new Error('Chunk ID and text required');
    if (ids.has(chunk.chunkId)) throw new Error(`Duplicate chunk ID: ${chunk.chunkId}`);
    if (chunk.sectionHeader !== undefined && chunk.sectionHeader !== null && typeof chunk.sectionHeader !== 'string') throw new Error('Invalid chunk title');
    ids.add(chunk.chunkId);
    return { chunkId: chunk.chunkId, text: chunk.text, sectionHeader: chunk.sectionHeader as string | null | undefined };
  });
  return { corpusVersion: source.corpusVersion, chunks };
}
export async function buildEmbeddingArtifact(input: unknown, client: Pick<OpenRouterClient, 'embed'>, options: BuildOptions = {}): Promise<EmbeddingArtifact> {
  const source = validateSource(input);
  const dimensions = boundedInteger(options.dimensions ?? 768, 3072, 'dimensions');
  const batchSize = boundedInteger(options.batchSize ?? 32, 128, 'batchSize');
  const concurrency = boundedInteger(options.concurrency ?? 2, 8, 'concurrency');
  const batches: EmbeddingChunk[][] = [];
  for (let i = 0; i < source.chunks.length; i += batchSize) batches.push(source.chunks.slice(i, i + batchSize));
  const results: EmbeddingArtifact['entries'][] = new Array(batches.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < batches.length) {
      const index = next++;
      const batch = batches[index];
      try {
        const vectors = await client.embed(batch.map(chunk => formatEmbeddingDocument(chunk.text, chunk.sectionHeader)), dimensions);
        results[index] = batch.map((chunk, i) => ({ chunkId: chunk.chunkId, contentHash: embeddingContentHash(chunk), vector: vectors[i] }));
      } catch (error) { failed = true; throw error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return { corpusVersion: source.corpusVersion, embeddingModel: EMBEDDING_MODEL, embeddingDim: dimensions, formatVersion: EMBEDDING_FORMAT_VERSION, entries: results.flat() };
}
export async function writeEmbeddingArtifact(path: string, artifact: EmbeddingArtifact): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(artifact)}\n`, { encoding: 'utf8', flag: 'wx' }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}
async function main() {
  const [inputPath = 'public/data/chunks_index.json', outputPath = 'data/openrouter_embeddings.json'] = process.argv.slice(2);
  const client = new OpenRouterClient();
  const source: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
  const artifact = await buildEmbeddingArtifact(source, client, {
    dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 768),
    batchSize: Number(process.env.EMBEDDING_BATCH_SIZE ?? 32),
    concurrency: Number(process.env.EMBEDDING_CONCURRENCY ?? 2),
  });
  await writeEmbeddingArtifact(outputPath, artifact);
  console.log(`Wrote ${artifact.entries.length} document embeddings (${artifact.embeddingDim} dimensions) to ${outputPath}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Embedding build failed'); process.exitCode = 1; });
}
