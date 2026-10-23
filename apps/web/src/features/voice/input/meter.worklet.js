/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * Input level meter (features/voice/input/meter.ts), an AudioWorklet: passes the audio through
 * unchanged and posts its level about every 20 ms — the RMS of the first channel in dBFS,
 * -100 for silence. It runs on the audio thread, so levels keep coming while the tab is in the
 * background (timers there are throttled, and the voice activity gate reads these). Posting
 * 'stop' ends it.
 */
const REPORT_SECONDS = 0.02;
const FLOOR_DB = -100;

class EnboxLevelMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sum = 0;
    this.frames = 0;
    this.every = Math.round(sampleRate * REPORT_SECONDS);
    this.running = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.running = false;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (input && input.length > 0) {
      const samples = input[0];
      for (let i = 0; i < samples.length; i++) this.sum += samples[i] * samples[i];
      this.frames += samples.length;
      for (let c = 0; c < output.length; c++) output[c].set(input[Math.min(c, input.length - 1)]);
    } else {
      this.frames += 128;
    }
    if (this.frames >= this.every) {
      const rms = Math.sqrt(this.sum / this.frames);
      this.port.postMessage(rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB);
      this.sum = 0;
      this.frames = 0;
    }
    return this.running;
  }
}

registerProcessor('enbox-level-meter', EnboxLevelMeter);
