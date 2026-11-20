package postgresbackend

import (
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// bullmqSQLState is the SQLSTATE the shared commands raise for queue
// semantics errors. The DETAIL carries the same numeric code the Lua
// commands return (-1 missing job, -2 missing lock, ...).
const bullmqSQLState = "BM001"

// mapError turns a BM001 error raised by the shared SQL into a
// [bullmq.ScriptError], which unwraps to the matching sentinel error.
func mapError(cmd string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == bullmqSQLState {
		if code, convErr := strconv.ParseInt(strings.TrimSpace(pgErr.Detail), 10, 64); convErr == nil {
			return &bullmq.ScriptError{Code: code, Script: cmd}
		}
	}
	return err
}

// codeError turns a negative status code returned by a command into a
// [bullmq.ScriptError].
func codeError(cmd string, code int64) error {
	return &bullmq.ScriptError{Code: code, Script: cmd}
}

// isTransientError reports whether err is a connectivity or server
// availability problem, or a transaction the server aborted to resolve a
// conflict, all of which are worth retrying.
func isTransientError(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	var connectErr *pgconn.ConnectError
	if errors.As(err, &connectErr) {
		return true
	}
	if pgconn.SafeToRetry(err) || pgconn.Timeout(err) {
		return true
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch {
		case strings.HasPrefix(pgErr.Code, "08"): // connection exception
			return true
		case pgErr.Code == "40001", // serialization_failure
			pgErr.Code == "40P01", // deadlock_detected
			pgErr.Code == "53300", // too_many_connections
			pgErr.Code == "57P01", // admin_shutdown
			pgErr.Code == "57P02", // crash_shutdown
			pgErr.Code == "57P03": // cannot_connect_now
			return true
		}
	}
	return false
}

// isUndefinedTable reports whether err is SQLSTATE 42P01.
func isUndefinedTable(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}
