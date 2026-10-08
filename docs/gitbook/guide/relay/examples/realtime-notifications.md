# Real-time notifications for WebSocket servers

**Scenario:** your users keep a WebSocket open to one of several API servers
behind a load balancer. Any part of your system (an API request, a worker,
a scheduled job) needs to notify a user in real time, without knowing which
server they are connected to.

Each API server subscribes to the notification topic of every user connected
to it, while at least one of their sockets is open. Senders just publish on
the user's topic.

## API server

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { Relay, RelaySubscription } from 'bullmq';

const relay = new Relay({ connection: { host: 'redis.internal', port: 6379 } });
const wss = new WebSocketServer({ server: httpServer });

interface ConnectedUser {
  sockets: Set<WebSocket>;
  subscription: Promise<RelaySubscription>;
}
const users = new Map<string, ConnectedUser>();

const userTopic = (userId: string) => `users.${userId}.notifications`;

wss.on('connection', async (socket, request) => {
  const userId = await authenticate(request); // e.g. from a session cookie
  if (!userId) {
    return socket.close(4001, 'unauthorized');
  }

  let user = users.get(userId);
  if (!user) {
    // First socket of this user on this server: subscribe once for all of them.
    const sockets = new Set<WebSocket>();
    user = {
      sockets,
      subscription: relay.subscribe(userTopic(userId), message => {
        const payload = JSON.stringify(message.data);
        sockets.forEach(s => s.send(payload));
      }),
    };
    users.set(userId, user);
  }
  user.sockets.add(socket);

  socket.on('close', async () => {
    const current = users.get(userId)!;
    current.sockets.delete(socket);
    if (current.sockets.size === 0) {
      // Last socket of this user on this server.
      users.delete(userId);
      await (await current.subscription).unsubscribe();
    }
  });
});
```

User ids must be valid topic segments; encode them otherwise (see
[Values in topics](../topics-and-patterns.md#values-in-topics)).

## Sending a notification

From any process, for example a worker:

```typescript
import { Queue, Relay } from 'bullmq';

const relay = new Relay({ connection });
const pushQueue = new Queue('push-notifications', { connection });

export async function notify(userId: string, notification: Notification) {
  await db.notifications.insert(userId, notification); // the inbox in your UI

  const { endpoints } = await relay.publish(
    `users.${userId}.notifications`,
    notification,
  );

  if (endpoints === 0) {
    // The user has no open connection: fall back to a mobile push.
    await pushQueue.add('push', { userId, notification });
  }
}
```

`endpoints` is the number of subscriptions that received the message, here
the number of API servers holding a socket for that user.

## Why the Relay

- **Messages only go to the server that holds the user's sockets**, not to
  every server.
- **A server that briefly loses its datastore connection still delivers the
  notifications** published meanwhile, from its inbox.
- **Publishing tells you whether the user is online**, which lets you fall
  back to other channels, typically through a queue.

## Things to watch

- The Relay delivers live messages. Store notifications in your database as
  well, so users find them when they come back.
- Notify whole groups with a shared topic (`tenants.acme.announcements`) that
  each server subscribes to when it has at least one user of that group.
