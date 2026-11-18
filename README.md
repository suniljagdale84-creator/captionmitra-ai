# CaptionMitra AI

AI-assisted video transcription and subtitle translation for Hindi, Marathi, Hinglish and English.

## Requirements
- Node.js 20+
- An OpenAI API key with API billing enabled

## Local setup
1. Run `npm install`
2. Copy `.env.example` to `.env.local`
3. Add your key to `.env.local` as `OPENAI_API_KEY=...`
4. Run `npm run dev`
5. Open http://localhost:3000

## Deploy on Vercel
1. Push the contents of this folder (not the ZIP file) to the root of a GitHub repository.
2. Import that repository into Vercel.
3. In Vercel Project Settings → Environment Variables, add `OPENAI_API_KEY`.
4. Redeploy after adding the variable.

## Important
- Never commit `.env.local` or expose API keys in browser code.
- This starter creates SRT and TXT subtitles. It does not yet burn subtitles into MP4.
- The API uses OpenAI audio transcription and translation; usage may incur API charges.
- Add authentication, usage limits, privacy/retention controls, monitoring and payment verification before a public commercial launch.
