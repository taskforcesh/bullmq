package postgresbackend

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	jobsChannel   = "bullmq_jobs"
	eventsChannel = "bullmq_events"

	// listenStopTimeout bounds how long closing a listener waits for its
	// reader to let go of the connection.
	listenStopTimeout = 5 * time.Second
	// listenRetryMin and listenRetryMax bound the backoff between attempts to
	// re-establish a lost LISTEN connection.
	listenRetryMin = 100 * time.Millisecond
	listenRetryMax = 5 * time.Second
)

// listener owns one dedicated connection, opened outside the query pool so a
// long-lived LISTEN never holds a pool slot, and subscribed to one of the
// shared notification channels. A reader goroutine consumes every
// notification as soon as it arrives, so the server's notification queue
// never backs up behind a busy worker, and wakes the waiters of this queue.
type listener struct {
	queue      string
	channel    string
	listenCmd  string
	connConfig func() *pgx.ConnConfig

	mu      sync.Mutex
	name    string
	running bool
	closed  bool
	cancel  context.CancelFunc
	done    chan struct{}

	sigMu sync.Mutex
	sig   chan struct{}
}

func newListener(queue, channel, listenCmd, name string, connConfig func() *pgx.ConnConfig) *listener {
	return &listener{
		queue:      queue,
		channel:    channel,
		listenCmd:  listenCmd,
		connConfig: connConfig,
		name:       name,
		sig:        make(chan struct{}),
	}
}

// signalled returns a channel that is closed by the next notification for
// the queue (or by a reconnection, which may have missed some). Waiters take
// it before they look at the datastore, so nothing that happens afterwards is
// missed.
func (l *listener) signalled() <-chan struct{} {
	l.sigMu.Lock()
	defer l.sigMu.Unlock()
	return l.sig
}

func (l *listener) signal() {
	l.sigMu.Lock()
	close(l.sig)
	l.sig = make(chan struct{})
	l.sigMu.Unlock()
}

// ensure opens the connection and subscribes to the channel, unless that is
// already done. The first connection is made synchronously so a failure is
// reported to the caller and the subscription is active when it returns.
func (l *listener) ensure(ctx context.Context) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return errClosed
	}
	if l.running {
		return nil
	}
	return l.start(ctx)
}

// setName changes the application_name of the connection, reconnecting when
// it is already open under another name, and opens it otherwise.
func (l *listener) setName(ctx context.Context, name string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return errClosed
	}
	if l.running && l.name == name {
		return nil
	}
	l.name = name
	if l.running {
		l.stop()
	}
	return l.start(ctx)
}

// isRunning reports whether the connection is established.
func (l *listener) isRunning() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.running
}

// close stops the reader and closes the connection for good.
func (l *listener) close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closed = true
	if l.running {
		l.stop()
	}
}

// start connects and launches the reader. The caller holds mu.
func (l *listener) start(ctx context.Context) error {
	conn, err := l.connect(ctx, l.name)
	if err != nil {
		return err
	}
	runCtx, cancel := context.WithCancel(context.Background())
	l.cancel = cancel
	l.done = make(chan struct{})
	l.running = true
	go l.run(runCtx, conn, l.name, l.done)
	return nil
}

// stop cancels the reader and waits, bounded, for it to close the
// connection. The caller holds mu.
func (l *listener) stop() {
	l.cancel()
	select {
	case <-l.done:
	case <-time.After(listenStopTimeout):
	}
	l.running = false
}

func (l *listener) connect(ctx context.Context, name string) (*pgx.Conn, error) {
	listenSQL, err := command(l.listenCmd)
	if err != nil {
		return nil, err
	}
	cfg := l.connConfig()
	if name != "" {
		cfg.RuntimeParams["application_name"] = name
	}
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Exec(ctx, listenSQL); err != nil {
		closeConn(conn)
		return nil, err
	}
	return conn, nil
}

// run reads notifications until ctx is cancelled, re-establishing the
// connection with a backoff when it is lost.
func (l *listener) run(ctx context.Context, conn *pgx.Conn, name string, done chan struct{}) {
	defer close(done)
	defer func() {
		if conn != nil {
			closeConn(conn)
		}
	}()
	for {
		n, err := conn.WaitForNotification(ctx)
		if err == nil {
			if n.Channel == l.channel && n.Payload == l.queue {
				l.signal()
			}
			continue
		}
		if ctx.Err() != nil {
			return
		}
		closeConn(conn)
		conn = nil
		// Waiters re-check the datastore: notifications may be lost while the
		// connection is down.
		l.signal()
		for delay := listenRetryMin; conn == nil; delay = min(delay*2, listenRetryMax) {
			if !sleepCtx(ctx, delay) {
				return
			}
			conn, _ = l.connect(ctx, name)
		}
		l.signal()
	}
}

func closeConn(conn *pgx.Conn) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = conn.Close(ctx)
}
