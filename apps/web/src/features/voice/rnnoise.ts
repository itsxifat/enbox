/**
 * Voice isolation for voice channels and the mic test: the RNNoise node of the calls' voice
 * isolation (features/calls/voice.ts — the same package, worklet and 48 kHz requirement), made
 * for an audio context of ours so it can sit in a longer graph (the input processor's gate,
 * the meter). Loaded on first use; the wasm is fetched once.
 */
import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';

/** RNNoise works on 48 kHz frames: contexts it runs in use this rate. */
export const RNNOISE_SAMPLE_RATE = 48_000;

let wasm: Promise<ArrayBuffer> | null = null;
const worklets = new WeakMap<BaseAudioContext, Promise<void>>();

export async function createRnnoiseNode(ctx: AudioContext): Promise<RnnoiseWorkletNode> {
  const [lib, worklet, wasmUrl, simdUrl] = await Promise.all([
    import('@sapphi-red/web-noise-suppressor'),
    import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
    import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
    import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
  ]);
  wasm ??= lib.loadRnnoise({ url: wasmUrl.default, simdUrl: simdUrl.default }).catch((e) => {
    wasm = null;
    throw e;
  });
  const wasmBinary = await wasm;
  let added = worklets.get(ctx);
  if (!added) {
    added = ctx.audioWorklet.addModule(worklet.default);
    added.catch(() => worklets.delete(ctx));
    worklets.set(ctx, added);
  }
  await added;
  return new lib.RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
}
