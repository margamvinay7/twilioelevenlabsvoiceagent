# 🤖 AI Voice Agent for Customer Service

A real-time AI voice agent that can make outbound calls and have natural conversations with customers for telecom sales and recharge offers.

## ✨ Features

- **Real-time Voice Calls**: Make outbound calls using Twilio
- **AI-Powered Conversations**: Uses Google Gemini for intelligent responses
- **Natural Speech**: ElevenLabs TTS and STT for human-like voice interaction
- **Sales Focused**: Specifically designed for telecom recharge sales
- **Continuous Conversation**: Maintains call connection for extended conversations
- **WebSocket Streaming**: Real-time audio streaming between user and AI

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
HTTP_PORT=3001
PUBLIC_HTTP_URL=http://localhost:3001 replace with ngrok url for both http and ws
PUBLIC_WS_URL=ws://localhost:3001/ws

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_NUMBER=+1234567890

# ElevenLabs Configuration (for TTS and STT)
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id_here

# Google Gemini Configuration (for AI responses)
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Get API Keys

#### Twilio
1. Sign up at [twilio.com](https://twilio.com)
2. Get your Account SID and Auth Token from the dashboard
3. Get a phone number for making calls

#### ElevenLabs
1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Get your API key from the profile settings
3. Create or select a voice ID for TTS

#### Google Gemini
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create an API key for Gemini

### 4. Start the Server

```bash
node index.js
```

The server will start on port 3001 (or the port specified in your .env file).

### 5. Test the System

Open `test-client.html` in your browser to test the voice agent:

1. Enter a phone number to call
2. Click "Start Call"
3. The AI will initiate the call and start the conversation
4. Monitor the call status and logs

## 📞 How It Works

1. **Call Initiation**: POST to `/call` endpoint with phone number
2. **TwiML Generation**: Creates voice response with streaming configuration
3. **WebSocket Connection**: Establishes real-time audio streaming
4. **Audio Processing**: 
   - Receives user audio via WebSocket
   - Converts to WAV format
   - Sends to ElevenLabs for speech-to-text
5. **AI Response**: 
   - Processes user input with Gemini AI
   - Generates sales-focused responses
   - Converts to speech via ElevenLabs TTS
6. **Audio Streaming**: Sends AI response back to user via Twilio

## 🔧 API Endpoints

- `POST /call` - Initiate a new call
- `POST /twiml` - TwiML response for call handling
- `GET /health` - Server health check
- `GET /calls/status` - Check active calls
- `POST /calls/end/:callSid` - End a specific call

## 🎯 Sales Conversation Features

The AI is specifically trained for telecom sales with:

- **Recharge Offers**: 20% extra balance on recharges above ₹100
- **Free Data**: 7 days of free data with recharge
- **Night Calling**: Free night calling for a month
- **Multiple Options**: Recharge amounts of ₹100, ₹200, and ₹500
- **Persuasive Responses**: Natural conversation flow with sales techniques

## 🛠️ Troubleshooting

### Call Hanging Up
- Ensure your Twilio account has sufficient credits
- Check that the phone number is verified (for trial accounts)
- Verify WebSocket connection is established

### Audio Issues
- Check ElevenLabs API key and voice ID
- Ensure proper audio format conversion (mulaw to PCM)
- Monitor WebSocket connection status

### AI Responses
- Verify Gemini API key is valid
- Check internet connectivity for API calls
- Monitor conversation history for context

## 📁 Project Structure

```
vocieAgentBackend/
├── index.js              # Main server file
├── ulaw.js               # Audio format conversion utilities
├── wav.js                # WAV file handling
├── test-client.html      # Test interface
├── package.json          # Dependencies
└── README.md            # This file
```

## 🔒 Security Notes

- Never commit your `.env` file to version control
- Keep your API keys secure
- Use HTTPS in production
- Implement rate limiting for production use

## 🚀 Production Deployment

For production deployment:

1. Use HTTPS endpoints
2. Implement proper error handling and logging
3. Add rate limiting and authentication
4. Use environment-specific configurations
5. Monitor WebSocket connections and call quality
6. Implement call recording and analytics

## 📞 Testing

1. **Local Testing**: Use ngrok to expose local server
2. **Phone Testing**: Use real phone numbers for full testing
3. **Audio Quality**: Test with different audio conditions
4. **Conversation Flow**: Test various user responses and scenarios

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

This project is licensed under the ISC License. 
