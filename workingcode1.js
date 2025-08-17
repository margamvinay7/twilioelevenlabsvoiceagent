// server.js
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import twilio from "twilio";
import { WebSocketServer } from "ws";
import fetch from "node-fetch"; // v2
import FormData from "form-data";
import { Readable } from "stream";
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

import http from "http";
import { Buffer } from "buffer";



import { mulawToPCM16, sendMulawToTwilio, } from "./ulaw.js";
import {convertPcmToMuLawBuffer } from './utils/audio.js'
import { pcm16ToWavBuffer } from "./wav.js";

dotenv.config();

const HTTP_PORT = Number(process.env.HTTP_PORT || 3001);
const PUBLIC_HTTP_URL = process.env.PUBLIC_HTTP_URL;
const PUBLIC_WS_URL = process.env.PUBLIC_WS_URL;

const elevenlabs = new ElevenLabsClient();
const app = express();
const server = http.createServer(app);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Store active call sessions
const activeCalls = new Map();

// --- Twilio endpoints ---
app.post("/call", async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: "Missing 'to'" });

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_NUMBER,
      url: `${PUBLIC_HTTP_URL}/twiml`,
    });

    console.log("Started outbound call:", call.sid);
    return res.json({ ok: true, callSid: call.sid });
  } catch (err) {
    console.error("Call error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/twiml", (req, res) => {
  const vr = new twilio.twiml.VoiceResponse();

  vr.say("Hello!"); // short greeting before streaming
  vr.pause({ length: 1 });
  vr.say("Connecting you to our A I assistant...");

  const connect = vr.connect();
  connect.stream({
    url: PUBLIC_WS_URL.replace('ws://', 'wss://').replace('http://', 'https://'),
    statusCallback: `${PUBLIC_HTTP_URL}/stream/status`,
    statusCallbackMethod: "POST"
  });

  // No more TwiML after <Connect><Stream>
  res.type("text/xml").send(vr.toString());
});


server.listen(HTTP_PORT, () => {
  console.log(`Server running on port ${HTTP_PORT}`);
});

// ------------------ WebSocket ------------------
const wss = new WebSocketServer({ 
  server, 
  path: "/ws",
  perMessageDeflate: false,
  maxPayload: 1024 * 1024 // 1MB max payload
});
console.log("WebSocket server ready /ws");

wss.on("connection", (ws, req) => {
  ws._streamSid = null;
  console.log("\n🔌 ===== WEBSOCKET CONNECTION ESTABLISHED =====");
  console.log(`🔗 Connection URL: ${req.url}`);
  console.log(`⏰ Connection time: ${new Date().toLocaleTimeString()}`);
  console.log("Twilio connected");
  
  let callSession = {
    buffer: Buffer.alloc(0),
    isProcessing: false,
    conversationHistory: [],
    callStartTime: Date.now(),
    userResponses: 0,
    lastActivity: Date.now(),
    audioChunks: 0,
    mediaReceived: false
  };

  // Log connection summary every 30 seconds
  

  
  ws.on("message", async (raw) => {
    let evt;
    try {
      evt = JSON.parse(raw.toString());
      console.log(`📨 WebSocket event received: ${evt.event}`);
      
      // Log stream parameters if available
      if (evt.start && evt.start.customParameters) {
        console.log(`🔧 Stream parameters:`, evt.start.customParameters);
      }
    } catch (error) {
      console.error("❌ Failed to parse WebSocket message:", error);
      return;
    }

    // Update last activity
    callSession.lastActivity = Date.now();

    if (evt.event === "start") {
      ws._streamSid = evt.start?.streamSid; // <-- save it
      console.log("Stream SID:", ws._streamSid);
      console.log(`🔧 Stream details:`, {
        streamSid: evt.start?.streamSid,
        customParameters: evt.start?.customParameters,
        mediaFormat: evt.start?.mediaFormat
      });
    }

    if (evt.event === "media") {
      const mulawChunk = Buffer.from(evt.media.payload, "base64");
      const pcm16 = mulawToPCM16(mulawChunk);
      callSession.buffer = Buffer.concat([callSession.buffer, pcm16]);
      callSession.audioChunks++;
      callSession.mediaReceived = true; // Mark that media has been received
      
      // Only log every 10th chunk to reduce console spam
      if (callSession.audioChunks % 10 === 0) {
        console.log(`🎵 Received audio chunk ${callSession.audioChunks}, buffer size: ${callSession.buffer.length} bytes`);
      }
      
      // Process audio when we have enough data - every 2 seconds worth of audio
      // At 8kHz, 16-bit mono: 8000 samples * 2 bytes = 16000 bytes per second
      // So 32000 bytes = 2 seconds of audio (better for conversation, less frequent)
      if (callSession.buffer.length >= 32000 && !callSession.isProcessing) {
        console.log("🔄 Processing audio chunk...");
        const turn = callSession.buffer;
        callSession.buffer = Buffer.alloc(0);
        callSession.isProcessing = true;

        processTurn(ws, turn, callSession).catch((e) => {
          console.error("processTurn error", e);
          callSession.isProcessing = false;
        });
      }
    }

    if (evt.event === "stop") {
      console.log("⏹️ Got stop event, closing stream");
      ws.close();
    }

    if (evt.event === "mark") {
      console.log("📍 Got mark event, processing remaining audio");
      // Process any remaining audio
      if (callSession.buffer.length > 0 && !callSession.isProcessing) {
        const turn = callSession.buffer;
        callSession.buffer = Buffer.alloc(0);
        callSession.isProcessing = true;

        processTurn(ws, turn, callSession).catch((e) => {
          console.error("processTurn error", e);
          callSession.isProcessing = false;
        });
      }
    }

  
  });

  ws.on("close", () => {
    console.log("WS closed");
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    clearInterval(keepAlive);
    clearInterval(audioProcessor);
    clearInterval(connectionLogger);
  });
});

// ------------------ Processing ------------------
async function processTurn(ws, pcm16Buffer, callSession) {
  try {
    console.log(`\n🔄 ===== PROCESSING TURN =====`);
    console.log(`📊 Audio buffer size: ${pcm16Buffer.length} bytes`);
    console.log(`⏰ Processing time: ${new Date().toLocaleTimeString()}`);
    
    // Only process if we have enough audio data (at least 0.5 seconds)
    if (pcm16Buffer.length < 8000) {
      console.log("❌ Audio buffer too small, skipping processing");
      callSession.isProcessing = false;
      return;
    }
    
    // Convert PCM to WAV
    console.log("🔄 Converting PCM to WAV format...");
    const wavBuf = pcm16ToWavBuffer(pcm16Buffer, 8000, 1);
    console.log(`✅ Converted to WAV: ${wavBuf.length} bytes`);

    // STT
    console.log("\n🎤 ===== SPEECH TO TEXT ======");
    console.log("📤 Sending to ElevenLabs for speech-to-text...");
    const userText = await elevenlabsSTT(wavBuf);
    
    if (!userText || userText.trim().length < 3) {
      console.log("❌ No speech detected or text too short, continuing to listen");
      console.log(`📝 Raw STT result: "${userText}"`);
      callSession.isProcessing = false;
      return;
    }

    // Display user speech prominently
    console.log("\n" + "=".repeat(50));
    console.log("🎯 USER SAID: " + userText.toUpperCase());
    console.log("=".repeat(50));
    console.log(`📝 Transcribed text: "${userText}"`);
    console.log(`📏 Text length: ${userText.length} characters`);

    // Add to conversation history
    callSession.conversationHistory.push({ role: "user", content: userText });
    callSession.userResponses++;
    console.log(`📚 Conversation history updated. User responses: ${callSession.userResponses}`);

    // LLM reply with sales context
    console.log("\n🤖 ===== AI RESPONSE GENERATION ======");
    console.log("🧠 Generating AI response...");
    const reply = await generateSalesResponse(userText, callSession);
    console.log(`✅ AI Agent response: "${reply}"`);

    // Add AI response to history
    callSession.conversationHistory.push({ role: "assistant", content: reply });
    if (callSession.conversationHistory.length > 12) {
      callSession.conversationHistory = callSession.conversationHistory.slice(-12);
    }
    // TTS -> Twilio
    console.log("\n🔊 ===== TEXT TO SPEECH ======");
    console.log("🎵 Converting AI response to speech...");
    const mulawBuff = await elevenlabsTTSMulaw(reply);
    await sendMulawToTwilio(ws, mulawBuff);
    console.log("✅ Audio sent to Twilio successfully");
    if (mulawBuff.length > 0) {
      console.log(`📤 Sending ${mulawBuff.length} bytes of audio to Twilio`);
      try {
        // Send audio in smaller chunks to ensure delivery
        // await sendMulawToTwilio(ws, mulawBuff);
        console.log("✅ Audio sent to Twilio successfully");
        
        // Wait longer to ensure audio is processed and played
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Send a mark event to ensure audio is played
        const markEvent = {
          event: "mark",
          mark: { name: "response-complete" }
        };
        ws.send(JSON.stringify(markEvent));
        console.log("📍 Mark event sent to ensure audio playback");
        
        // Add another delay to ensure mark is processed
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (audioError) {
        console.error("❌ Error sending audio to Twilio:", audioError);
        // Try to send a simple text message as fallback
        try {
          console.log("🔄 Trying fallback message...");
          const fallbackText = "I'm having trouble with my voice. Let me continue with our conversation.";
          const fallbackAudio = await elevenlabsTTSMulaw(fallbackText);
          if (fallbackAudio.length > 0) {
            await sendMulawToTwilio(ws, fallbackAudio);
            console.log("✅ Fallback message sent successfully");
          }
        } catch (fallbackError) {
          console.error("❌ Fallback message also failed:", fallbackError);
        }
      }
    } else {
      console.error("❌ Failed to generate audio from AI response");
    }

    callSession.isProcessing = false;
    console.log("\n✅ ===== TURN PROCESSING COMPLETED =====\n");
  } catch (err) {
    console.error("❌ processTurn error:", err);
    callSession.isProcessing = false;
    
    // Try to recover by sending a fallback message
    try {
      console.log("🔄 Sending fallback message due to error...");
      await speakText(ws, "I apologize for the technical issue. Let me continue with our conversation. What would you like to know about our recharge offers?");
    } catch (fallbackError) {
      console.error("❌ Fallback message failed:", fallbackError);
    }
  }
}

// ------------------ Sales Response Generation ------------------
async function generateSalesResponse(userText, callSession) {
  try {
    console.log(`Generating sales response for: "${userText}"`);
    
    // Use Gemini for all responses - no hardcoded responses
    const salesContext = `You are a professional telecom sales agent calling customers to offer recharge bonuses. 
    Your goal is to convince them to recharge their SIM card. Be friendly, persuasive, and address their concerns naturally.
    
    Current conversation: ${callSession.conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}
    
    User just said: "${userText}"
    
    Respond naturally as if you're having a real conversation. Keep responses under 2 sentences. Be persuasive but not pushy.
    Focus on telecom recharge offers, bonuses, and special deals and give response in english.`;

    console.log("🧠 Using Gemini AI for response generation...");
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: salesContext }] }]
        }),
      }
    );
    
    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`❌ Gemini API error ${resp.status}: ${errorText}`);
      throw new Error(`Gemini failed ${resp.status}: ${errorText}`);
    }
    
    const json = await resp.json();
    const response = json.candidates?.[0]?.content?.parts?.[0]?.text || "That's interesting! Tell me more about what you're looking for.";
    
    console.log(`✅ Gemini generated response: "${response}"`);
    return response;
  } catch (err) {
    console.error("❌ Gemini error:", err);
    // Fallback response if Gemini fails
    return "I apologize for the technical issue. Let me tell you about our special recharge offer today. We're giving 20% extra balance and free data for 7 days. Are you interested?";
  }
}

// ------------------ STT ------------------
async function elevenlabsSTT(wavBuffer) {
  try {
    console.log(`🎤 STT: Processing ${wavBuffer.length} bytes of WAV audio`);
    console.log(`⏰ STT start time: ${new Date().toLocaleTimeString()}`);
    
    const url = "https://api.elevenlabs.io/v1/speech-to-text";
    // Use the correct model name - ElevenLabs only supports these for STT
    const model = "scribe_v1"; // Changed from "eleven_multilingual_v2"

    const form = new FormData();
    form.append("file", wavBuffer, { filename: "audio.wav", contentType: "audio/wav" });
    form.append("model_id", model);

    console.log("📤 STT: Sending request to ElevenLabs...");
    console.log(`🔗 STT URL: ${url}`);
    console.log(`🤖 STT Model: ${model}`);
    
    const startTime = Date.now();
    const resp = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, ...form.getHeaders() },
      body: form,
    });

    const endTime = Date.now();
    console.log(`⏱️ STT: ElevenLabs response time: ${endTime - startTime}ms`);
    console.log(`📊 STT: ElevenLabs response status: ${resp.status}`);
    
    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`❌ STT: ElevenLabs API error ${resp.status}: ${errorText}`);
      
      // Try to parse error for better debugging
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.detail?.message) {
          console.error(`🔍 Error details: ${errorJson.detail.message}`);
        }
      } catch (e) {
        // Error text is not JSON, use as is
      }
      
      // Try fallback model if first one fails
      if (model === "scribe_v1") {
        console.log("🔄 Trying fallback model: scribe_v1_experimental");
        return await elevenlabsSTTFallback(wavBuffer);
      }
      
      throw new Error(`STT failed ${resp.status}: ${errorText}`);
    }
    
    const json = await resp.json();
    const recognizedText = json.text || "";
    
    // Display transcription result prominently
    if (recognizedText.trim()) {
      console.log("\n" + "🎯".repeat(20));
      console.log("🎯 TRANSCRIPTION SUCCESS! 🎯");
      console.log("🎯".repeat(20));
      console.log(`📝 Recognized text: "${recognizedText}"`);
      console.log(`📏 Text length: ${recognizedText.length} characters`);
      console.log(`⏰ STT completion time: ${new Date().toLocaleTimeString()}`);
      console.log("🎯".repeat(20) + "\n");
    } else {
      console.log("❌ STT: No text recognized (empty response)");
    }
    
    return recognizedText;
  } catch (err) {
    console.error("❌ STT error:", err);
    console.error(`⏰ STT error time: ${new Date().toLocaleTimeString()}`);
    return "";
  }
}



// Fallback STT function with experimental model
async function elevenlabsSTTFallback(wavBuffer) {
  try {
    console.log("🔄 STT Fallback: Using scribe_v1_experimental model");
    
    const url = "https://api.elevenlabs.io/v1/speech-to-text";
    const model = "scribe_v1_experimental";

    const form = new FormData();
    form.append("file", wavBuffer, { filename: "audio.wav", contentType: "audio/wav" });
    form.append("model_id", model);

    const resp = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, ...form.getHeaders() },
      body: form,
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`❌ STT Fallback also failed: ${resp.status}: ${errorText}`);
      return "";
    }
    
    const json = await resp.json();
    const recognizedText = json.text || "";
    
    if (recognizedText.trim()) {
      console.log("✅ STT Fallback succeeded!");
      console.log(`📝 Fallback recognized text: "${recognizedText}"`);
    }
    
    return recognizedText;
  } catch (err) {
    console.error("❌ STT Fallback error:", err);
    return "";
  }
}


function streamToArrayBuffer(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks).buffer);
    });
    readableStream.on('error', reject);
  });
}

// ------------------ TTS ------------------
async function elevenlabsTTSMulaw(text) {
  try {
    console.log(`TTS: Converting text to speech: "${text}"`);

    // const voiceId = process.env.ELEVENLABS_VOICE_ID;
    // const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
    const voiceId = '21m00Tcm4TlvDq8ikWAM';
    const outputFormat = 'ulaw_8000';
    const text1 = 'This is a test. You can now hang up. Thank you.';
    // 1. Fetch PCM16 audio (16kHz)
    // const resp = await fetch(url, {
    //   method: "POST",
    //   headers: {
    //     "xi-api-key": process.env.ELEVENLABS_API_KEY,
    //     "Content-Type": "application/json",
    //   },
    //   body: JSON.stringify({
    //     text:"This is a test. You can now hang up. Thank you.",
    //     model_id: "eleven_flash_v2_5",
    //     output_format: "ulaw_8000", // raw PCM16 (LE)
    //   }),
    // });

    const response = await elevenlabs.textToSpeech.convert(voiceId, {
      modelId: 'eleven_flash_v2_5',
      outputFormat: outputFormat,
      text,
    });
    const readableStream = Readable.from(response);
    const audioArrayBuffer = await streamToArrayBuffer(readableStream);
    return audioArrayBuffer;


  } catch (err) {
    console.error("TTS error:", err);
    return Buffer.alloc(0);
  }
}



async function speakText(ws, text) {
  const buff = await elevenlabsTTSMulaw(text);
  await sendMulawToTwilio(ws, buff);
}

