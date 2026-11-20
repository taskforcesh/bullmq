package bullmq

import (
	"context"
	"testing"
)

// clientListBackend reports fixed connection lists, named after base.
type clientListBackend struct {
	stubBackend
	base  string
	lists []string
}

func (b clientListBackend) ClientName(suffix string) string { return b.base + suffix }

func (b clientListBackend) GetClientList(context.Context) ([]string, error) { return b.lists, nil }

func workersOf(t *testing.T, base string, lists ...string) []WorkerInfo {
	t.Helper()
	q := &Queue{backend: clientListBackend{base: base, lists: lists}}
	workers, err := q.Workers(context.Background())
	if err != nil {
		t.Fatalf("Workers: %v", err)
	}
	return workers
}

func TestWorkersParsesTheRedisClientList(t *testing.T) {
	workers := workersOf(t, "bull:ZW1haWxz",
		"id=7 addr=127.0.0.1:5000 laddr=127.0.0.1:6379 fd=8 name=bull:ZW1haWxz age=3 idle=0 flags=b db=0\r\n"+
			"id=8 addr=127.0.0.1:5001 name=bull:ZW1haWxz:w:mailer-1 age=1 idle=1\r\n"+
			"id=9 addr=127.0.0.1:5002 name=bull:ZW1haWxz:qe age=1\r\n"+
			"id=10 addr=127.0.0.1:5003 name=bull:ZW1haWxzX age=1\r\n"+
			"id=11 addr=127.0.0.1:5004 name= age=1\r\n")
	if len(workers) != 2 {
		t.Fatalf("Workers = %+v, want the two workers", workers)
	}
	if w := workers[0]; w.Name != "" || w.Fields["id"] != "7" || w.Fields["addr"] != "127.0.0.1:5000" ||
		w.Fields["age"] != "3" || w.Fields["name"] != "bull:ZW1haWxz" {
		t.Errorf("unnamed worker = %+v", w)
	}
	if w := workers[1]; w.Name != "mailer-1" || w.Fields["id"] != "8" || w.Fields["idle"] != "1" ||
		w.Fields["name"] != "bull:ZW1haWxz:w:mailer-1" {
		t.Errorf("named worker = %+v", w)
	}
}

// PostgreSQL reports application names, which may contain spaces.
func TestWorkersReadsNamesWithSpaces(t *testing.T) {
	workers := workersOf(t, "my queue", "name=my queue\nname=my queue:w:a b\nname=my queue:qe\nname=other")
	if len(workers) != 2 || workers[0].Name != "" || workers[1].Name != "a b" ||
		workers[1].Fields["name"] != "my queue:w:a b" {
		t.Fatalf("Workers = %+v, want the unnamed worker and %q", workers, "a b")
	}
}

// A cluster reports one list per node; the node with the most workers is
// used, as in Node.js, so a worker connected to several nodes is listed once.
func TestWorkersUsesTheClusterNodeWithTheMostWorkers(t *testing.T) {
	workers := workersOf(t, "bull:ZW1haWxz",
		"id=1 name=bull:ZW1haWxz:w:a",
		"id=2 name=bull:ZW1haWxz:w:a\nid=3 name=bull:ZW1haWxz:w:b",
		"")
	if len(workers) != 2 || workers[0].Name != "a" || workers[1].Name != "b" || workers[0].Fields["id"] != "2" {
		t.Fatalf("Workers = %+v, want a and b from the second node", workers)
	}
}

func TestWorkersReturnsAnEmptyList(t *testing.T) {
	workers := workersOf(t, "bull:ZW1haWxz", "id=1 name=bull:b3RoZXI=")
	if workers == nil || len(workers) != 0 {
		t.Fatalf("Workers = %#v, want an empty, non-nil list", workers)
	}
}
