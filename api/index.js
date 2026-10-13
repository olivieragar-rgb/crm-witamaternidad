// Vercel serverless entry point: the Express app is itself a request handler.
// vercel.json rewrites every /api/* request to this function.
import app from '../server/app.js';

export default app;
