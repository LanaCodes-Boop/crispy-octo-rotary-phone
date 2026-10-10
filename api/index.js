// Vercel serverless entry: vercel.json rewrites every /api/* request here.
// Static pages are served straight from public/ by Vercel's CDN.
import { handle } from '../server.js';

export default handle;
