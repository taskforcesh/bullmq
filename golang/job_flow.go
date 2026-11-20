package bullmq

import (
	"context"
	"encoding/json"
)

// ChildrenValues returns the return value (JSON) of every completed child of
// the job, by child key (see [Dependencies]), as Node's getChildrenValues.
func (j *Job) ChildrenValues(ctx context.Context) (map[string]json.RawMessage, error) {
	b, err := j.ctx()
	if err != nil {
		return nil, err
	}
	return b.GetProcessedChildrenValues(ctx, j.ID)
}

// IgnoredChildrenFailures returns the failure reason of every child whose
// failure was ignored, with IgnoreDependencyOnFailure or
// ContinueParentOnFailure, by child key.
func (j *Job) IgnoredChildrenFailures(ctx context.Context) (map[string]string, error) {
	b, err := j.ctx()
	if err != nil {
		return nil, err
	}
	return b.GetIgnoredChildrenFailures(ctx, j.ID)
}

// FailedChildrenValues returns the same as [Job.IgnoredChildrenFailures].
//
// Deprecated: use [Job.IgnoredChildrenFailures]; Node deprecated
// getFailedChildrenValues too.
func (j *Job) FailedChildrenValues(ctx context.Context) (map[string]string, error) {
	return j.IgnoredChildrenFailures(ctx)
}

// Dependencies returns the children of the job grouped by status. With nil
// opts every group is returned in full; otherwise only the requested groups,
// one page each.
func (j *Job) Dependencies(ctx context.Context, opts *DependenciesOptions) (*Dependencies, error) {
	b, err := j.ctx()
	if err != nil {
		return nil, err
	}
	return b.GetDependencies(ctx, j.ID, opts)
}

// DependenciesCount returns how many children of the job are in each status.
func (j *Job) DependenciesCount(ctx context.Context) (DependencyCounts, error) {
	b, err := j.ctx()
	if err != nil {
		return DependencyCounts{}, err
	}
	return b.GetDependencyCounts(ctx, j.ID)
}

// RemoveChildDependency detaches the job, which must not have finished yet,
// from its parent, so the parent no longer waits for it; a parent left
// without pending children is moved to wait. It returns false when the job
// was not a pending child of its parent, or has no parent. On success the
// job's Parent and ParentKey are cleared.
func (j *Job) RemoveChildDependency(ctx context.Context) (bool, error) {
	b, err := j.ctx()
	if err != nil {
		return false, err
	}
	if j.ParentKey == "" {
		return false, nil
	}
	removed, err := b.RemoveChildDependency(ctx, j.ID, j.ParentKey)
	if err != nil || !removed {
		return false, err
	}
	j.Parent = nil
	j.ParentKey = ""
	return true, nil
}

// RemoveUnprocessedChildren removes, recursively, the children of the job
// that have not been processed yet: active, completed and failed children,
// and locked ones, are kept. It can be slow with many children.
func (j *Job) RemoveUnprocessedChildren(ctx context.Context) error {
	b, err := j.ctx()
	if err != nil {
		return err
	}
	return b.RemoveUnprocessedChildren(ctx, j.ID)
}
