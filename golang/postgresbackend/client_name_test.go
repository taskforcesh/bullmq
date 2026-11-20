package postgresbackend

import (
	"context"
	"fmt"
	"maps"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

func TestAppNameEscaping(t *testing.T) {
	if got, want := escapeAppName("café:w:\tx\x7f"), `caf\xc3\xa9:w:\x09x\x7f`; got != want {
		t.Errorf("escapeAppName = %q, want %q", got, want)
	}
	if got, want := legacyAppName("café:w:x"), "caf??:w:x"; got != want {
		t.Errorf("legacyAppName = %q, want %q", got, want)
	}
	for in, want := range map[string]string{
		`caf\xc3\xa9`:     "café",
		`w\xc3\xb6rker`:   "wörker",
		`plain`:           "plain",
		`tab\x09\x0aline`: `tab\x09\x0aline`, // control characters stay escaped
		`upper\xC3\xA9`:   `upper\xC3\xA9`,   // PostgreSQL writes lowercase hex
		`ascii\x41`:       `ascii\x41`,       // never escaped by PostgreSQL
		`cut\xc3\xa`:      "cut\xc3" + `\xa`, // truncated mid-escape
		`end\x`:           `end\x`,
	} {
		if got := unescapeAppName(in); got != want {
			t.Errorf("unescapeAppName(%q) = %q, want %q", in, got, want)
		}
	}

	b := &Backend{name: "café-queue"}
	for in, want := range map[string]string{
		`caf\xc3\xa9-queue`:                 "café-queue",
		`caf\xc3\xa9-queue:w:w\xc3\xb6rker`: "café-queue:w:wörker",
		`caf\xc3\xa9-queue:qe`:              "café-queue:qe",
		`caf??-queue:w:w??rker`:             "café-queue:w:w??rker",
		`other:w:w\xc3\xb6rker`:             `other:w:w\xc3\xb6rker`,
	} {
		if got := b.clientNameAsSet(in); got != want {
			t.Errorf("clientNameAsSet(%q) = %q, want %q", in, got, want)
		}
	}
}

// PostgreSQL escapes the non-ASCII bytes of an application_name, so the
// workers of a queue, or with a name, outside ASCII are found only once the
// escaping is undone.
func TestWorkersOfANonASCIIQueue(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	factory := New(Options{ConnString: url, Schema: schema})
	queue := fmt.Sprintf("café-%d", time.Now().UnixNano())

	q, err := bullmq.NewQueue(queue, &bullmq.QueueOptions{Backend: factory})
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	for _, name := range []string{"", "wörker"} {
		w, err := bullmq.NewWorker(queue, func(context.Context, *bullmq.Job) (any, error) { return nil, nil },
			&bullmq.WorkerOptions{Backend: factory, Name: name, DrainDelay: 200 * time.Millisecond, SkipStalledCheck: true})
		if err != nil {
			t.Fatal(err)
		}
		runCtx, cancel := context.WithCancel(context.Background())
		stopped := make(chan struct{})
		go func() {
			defer close(stopped)
			_ = w.Run(runCtx)
		}()
		t.Cleanup(func() {
			cancel()
			<-stopped
			_ = w.Close()
		})
	}

	admin := adminConn(t)
	eventually(t, "the worker connections", func() bool {
		var n int
		err := admin.QueryRow(ctx,
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND starts_with(application_name, $1)`,
			escapeAppName(queue)).Scan(&n)
		return err == nil && n == 2
	})
	workers, err := q.Workers(ctx)
	if err != nil {
		t.Fatalf("Workers: %v", err)
	}
	got := map[string]string{}
	for _, w := range workers {
		got[w.Name] = w.Fields["name"]
	}
	if want := map[string]string{"": queue, "wörker": queue + ":w:wörker"}; !maps.Equal(got, want) {
		t.Fatalf("Workers = %+v, want the names and connection names %v", workers, want)
	}
}
