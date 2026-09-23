import { GlideClient } from '@valkey/valkey-glide';
import { createValkeyGlideClient } from './src/classes/valkey-glide-client';
import { setConnectionFactory } from './tests/utils/connection-factory';

setConnectionFactory(opts => {
  const raw = GlideClient.createClient({
    addresses: [
      {
        host: opts?.host || process.env.REDIS_HOST || 'localhost',
        port: opts?.port || Number(process.env.REDIS_PORT) || 6379,
      },
    ],
  });
  return createValkeyGlideClient(raw);
});
