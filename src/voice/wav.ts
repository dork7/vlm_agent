/** 16-bit PCM audio and how to play it. */
export type Pcm16 = { sampleRate: number; channels: number; samples: Int16Array };

/** A WAV file of 16-bit PCM samples, as whisper.cpp reads it. */
export function encodeWav({ sampleRate, channels, samples }: Pcm16): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.byteLength, 40);
  return Buffer.concat([header, data]);
}

/**
 * The samples of a 16-bit PCM WAV file, such as a text-to-speech server returns. Walks the chunks
 * rather than assuming a 44-byte header, and throws on anything else.
 */
export function decodeWav(file: Uint8Array): Pcm16 {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const tag = (offset: number) => String.fromCharCode(...file.subarray(offset, offset + 4));
  if (file.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");

  let format: { sampleRate: number; channels: number } | undefined;
  for (let offset = 12; offset + 8 <= file.byteLength; ) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      const encoding = view.getUint16(body, true);
      const bits = view.getUint16(body + 14, true);
      if (encoding !== 1 || bits !== 16) throw new Error(`Only 16-bit PCM WAV is supported, got format ${encoding} at ${bits} bits`);
      format = { channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true) };
    } else if (id === "data") {
      if (!format) throw new Error("WAV data came before its format");
      // Servers that stream sometimes write a placeholder size; take what is actually there.
      const end = Math.min(body + size, file.byteLength);
      const bytes = file.slice(body, end - ((end - body) % 2));
      return { ...format, samples: new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no audio data");
}
