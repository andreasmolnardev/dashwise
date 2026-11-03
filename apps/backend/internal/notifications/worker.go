package notifications

import (
	"context"
	"time"
)

// RunDeliveryWorker processes the outbox immediately, then retries on a fixed
// cadence. Individual delivery failures remain queued and do not stop the loop.
func (s *Store) RunDeliveryWorker(ctx context.Context, interval time.Duration, send func(context.Context, string, string) error) error {
	if interval <= 0 {
		interval = 10 * time.Second
	}
	if err := s.ProcessQueued(ctx, send, 100); err != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			_ = s.ProcessQueued(ctx, send, 100)
		}
	}
}
