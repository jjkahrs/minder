import { createApp } from './app.ts';

const port = Number(process.env.MINDER_PORT) || 4777;
const dev = process.argv.includes('--dev');

const app = await createApp({ dev });
app.server.on('error', (err) => {
  console.error(`[minder] ${err.message}`);
  process.exit(1);
});
// Loopback only: never bind other interfaces.
app.server.listen(port, '127.0.0.1', () => {
  console.log(`[minder] ${dev ? 'dev' : 'serving'} at http://127.0.0.1:${port}`);
});
