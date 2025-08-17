// ulaw.js
// μ-law <-> PCM16 utilities and paced sender for Twilio Media Streams
import Mulaw from "mulaw-js"; // npm i mulaw-js
import ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";
import { Buffer } from "buffer";

// μ-law decode table
const MULAW_MAX = 0x1FFF;
const MULAW_BIAS = 0x84;

export function mulawToPCM16(mulawBuf) {
  const out = Buffer.alloc(mulawBuf.length * 2);
  for (let i = 0; i < mulawBuf.length; i++) {
    const uVal = ~mulawBuf[i];
    let t = ((uVal & 0x0F) << 3) + MULAW_BIAS;
    t <<= ((uVal & 0x70) >> 4);
    t -= MULAW_BIAS;
    out.writeInt16LE(((uVal & 0x80) ? (MULAW_BIAS - 1) - t : t - MULAW_BIAS), i * 2);
  }
  return out;
}




/**
 * Send μ-law 8kHz audio back to Twilio paced as ~20ms frames.
 * 20ms @ 8kHz = 160 samples = 160 bytes (μ-law is 8-bit mono).
 */
export async function sendMulawToTwilio(ws, audioArrayBuffer) {
  
    ws.send(JSON.stringify({
      streamSid: ws._streamSid,
      event: "media",
      media: {
        payload: Buffer.from(audioArrayBuffer).toString('base64'),
      },
    }));
  
}



