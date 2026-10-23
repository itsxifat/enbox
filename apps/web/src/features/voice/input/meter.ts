/**
 * A level meter for a microphone graph: a node to put in the chain (the audio passes through
 * it unchanged) that reports the level in dBFS about every 20 ms. An AudioWorklet
 * (meter.worklet.js) where the browser has them — it keeps reporting in a background tab —
 * else an AnalyserNode read on every animation frame.
 *
 *   const meter = await createLevelMeter(ctx, (db) => …);
 *   source.connect(meter.node).connect(next);
 *   meter.stop();
 */
import { rmsToDb } from './level';

export interface LevelMeter {
  node: AudioNode;
  stop(): void;
}

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

function loadWorklet(ctx: AudioContext): Promise<void> {
  let ready = loaded.get(ctx);
  if (!ready) {
    ready = import('./meter.worklet.js?url').then((m) => ctx.audioWorklet.addModule(m.default));
    // A failed load may be retried (a later graph on this context).
    ready.catch(() => loaded.delete(ctx));
    loaded.set(ctx, ready);
  }
  return ready;
}

export async function createLevelMeter(
  ctx: AudioContext,
  onLevel: (db: number) => void,
): Promise<LevelMeter> {
  if (typeof AudioWorkletNode !== 'undefined' && ctx.audioWorklet) {
    try {
      await loadWorklet(ctx);
      const node = new AudioWorkletNode(ctx, 'enbox-level-meter');
      node.port.onmessage = (e: MessageEvent<number>) => onLevel(e.data);
      return {
        node,
        stop() {
          node.port.onmessage = null;
          node.port.postMessage('stop');
          node.disconnect();
        },
      };
    } catch (err) {
      console.warn('The level meter worklet did not load; reading levels per frame', err);
    }
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  const read = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    onLevel(rmsToDb(Math.sqrt(sum / samples.length)));
    frame = requestAnimationFrame(read);
  };
  frame = requestAnimationFrame(read);
  return {
    node: analyser,
    stop() {
      cancelAnimationFrame(frame);
      analyser.disconnect();
    },
  };
}
