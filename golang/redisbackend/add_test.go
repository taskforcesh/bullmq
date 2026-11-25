package redisbackend

import (
	"errors"
	"testing"

	bullmq "github.com/taskforcesh/bullmq-go"
)

func TestParseAddReplyTreatsStringRepliesAsJobIDs(t *testing.T) {
	a := redisAdd{scriptName: "addStandardJob"}

	for _, id := range []string{"1", "custom", "-01", "-1", "0"} {
		got, err := a.parseReply(id)
		if err != nil {
			t.Errorf("parseReply(%q) returned error: %v", id, err)
			continue
		}
		if got != id {
			t.Errorf("parseReply(%q) = %q, want the same id", id, got)
		}
	}

	got, err := a.parseReply([]byte("-01"))
	if err != nil || got != "-01" {
		t.Errorf("parseReply([]byte(\"-01\")) = %q, %v; want \"-01\", nil", got, err)
	}
}

func TestParseAddReplyTreatsNegativeIntegersAsStatusCodes(t *testing.T) {
	a := redisAdd{scriptName: "addStandardJob"}

	_, err := a.parseReply(int64(bullmq.ErrCodeJobNotExist))
	if !errors.Is(err, bullmq.ErrJobNotFound) {
		t.Errorf("parseReply(%d) error = %v, want ErrJobNotFound", bullmq.ErrCodeJobNotExist, err)
	}

	_, err = a.parseReply(int64(bullmq.ErrCodeParentJobNotExist))
	if !errors.Is(err, bullmq.ErrParentJobNotExist) {
		t.Errorf("parseReply(%d) error = %v, want ErrParentJobNotExist", bullmq.ErrCodeParentJobNotExist, err)
	}
}

func TestParseAddReplyRejectsUnexpectedReplies(t *testing.T) {
	a := redisAdd{scriptName: "addStandardJob"}
	if _, err := a.parseReply(nil); err == nil {
		t.Error("parseReply(nil) succeeded, want an error")
	}
}
