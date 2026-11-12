package bullmq

import (
	"errors"
	"testing"
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

	_, err := a.parseReply(int64(ErrCodeJobNotExist))
	if !errors.Is(err, ErrJobNotFound) {
		t.Errorf("parseReply(%d) error = %v, want ErrJobNotFound", ErrCodeJobNotExist, err)
	}

	_, err = a.parseReply(int64(ErrCodeParentJobNotExist))
	if !errors.Is(err, ErrParentJobNotExist) {
		t.Errorf("parseReply(%d) error = %v, want ErrParentJobNotExist", ErrCodeParentJobNotExist, err)
	}
}

func TestParseAddReplyRejectsUnexpectedReplies(t *testing.T) {
	a := redisAdd{scriptName: "addStandardJob"}
	if _, err := a.parseReply(nil); err == nil {
		t.Error("parseReply(nil) succeeded, want an error")
	}
}
