// Local dev entry point: start the Express app with a listening server.
import app from './app.js';

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => console.log(`API en http://localhost:${PORT}`));
