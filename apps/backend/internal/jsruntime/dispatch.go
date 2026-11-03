package jsruntime

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/dop251/goja"
)

// Serialized event dispatch. Goja is not goroutine-safe: only one goroutine may
// run JavaScript at a time. Provider callbacks fired from Go (websocket
// messages, timers) must therefore be queued as dispatch items and executed on
// the goroutine that currently owns the VM — either the caller running a
// lifecycle hook or action, or this instance's dispatcher goroutine when the VM
// would otherwise be idle. A parked provider Promise (an async/await across a
// genuinely asynchronous operation such as a websocket auth handshake) is
// driven to settlement inside the owning call by pumping this queue.
const (
	maxTimersPerInstance   = 64
	maxTimerDelayMs        = 1<<31 - 1 // JavaScript timer delay ceiling
	defaultSettleLimit     = 2 * time.Minute
	maxPendingItems        = 256
	maxItemsPerServicePass = 64
)

// dispatchItem is one unit of work that must run inside the VM-owning critical
// section. Items only carry data and captured callables; they never touch the
// runtime from another goroutine because invoke runs under the instance lock.
type dispatchItem struct {
	due    time.Time
	kind   string
	sock   *jsSocket
	token  uint64
	name   string
	period time.Duration
	invoke func(ctx context.Context, i *Instance) error
}

// queueItem schedules an item. Callable from any goroutine; it never blocks on
// the VM-owning mutex. Every append attempts a wake token: the pile may
// already hold a token (the sender skips), but the consumer re-checks the
// queue after each token, so no queued item can be stranded behind a parked
// dispatcher.
func (i *Instance) queueItem(item *dispatchItem) {
	if item == nil || i.disposed.Load() {
		return
	}
	i.itemsMu.Lock()
	if len(i.pending) >= maxPendingItems {
		i.itemsMu.Unlock()
		i.queueOverflow(item)
		return
	}
	i.pending = append(i.pending, item)
	i.itemsMu.Unlock()
	i.startDispatcher()
	select {
	case i.wake <- struct{}{}:
	default:
	}
}

// queueOverflow enforces the dispatch bound: socket events that cannot be
// queued are treated as transport failure so a stuck provider cannot buffer
// unbounded data; timer callbacks are simply dropped.
func (i *Instance) queueOverflow(item *dispatchItem) {
	if item.sock != nil {
		item.sock.abort("instance event queue overflow")
		return
	}
	i.log("warn", "dropped scheduled runtime callback because the instance pending queue exceeded its bound", nil)
}

// takeDue removes the first due item from the queue. Callers hold i.mu.
func (i *Instance) takeDue(now time.Time) *dispatchItem {
	i.itemsMu.Lock()
	defer i.itemsMu.Unlock()
	for n, item := range i.pending {
		if item.due.IsZero() || !item.due.After(now) {
			i.pending = append(i.pending[:n], i.pending[n+1:]...)
			return item
		}
	}
	return nil
}

// nextDue returns the earliest future item time, or the zero time when the
// queue holds nothing. Callers hold i.mu.
func (i *Instance) nextDue() time.Time {
	i.itemsMu.Lock()
	defer i.itemsMu.Unlock()
	var next time.Time
	for _, item := range i.pending {
		if item.due.IsZero() {
			continue
		}
		if next.IsZero() || item.due.Before(next) {
			next = item.due
		}
	}
	return next
}

// serviceLocked runs due items until the queue holds only future items (or the
// per-pass item cap is reached). Callers hold i.mu. It returns the earliest
// future item time (zero when the queue is quiet).
func (i *Instance) serviceLocked(ctx context.Context) (time.Time, error) {
	var first error
	for n := 0; n < maxItemsPerServicePass; n++ {
		item := i.takeDue(time.Now())
		if item == nil {
			return time.Time{}, first
		}
		if err := i.runItem(ctx, item); err != nil && first == nil {
			first = err
		}
		if i.stopped {
			return time.Time{}, first
		}
	}
	return i.nextDue(), first
}

// runItem invokes a dispatch item under a fresh bounded context so a single
// provider callback cannot monopolize the VM-owning goroutine.
func (i *Instance) runItem(ctx context.Context, item *dispatchItem) error {
	if item.invoke == nil {
		return nil
	}
	bounded, cancel := context.WithTimeout(ctx, i.hookLimit)
	defer cancel()
	err := item.invoke(bounded, i)
	// Remove one-shot timers after they fire. Periodic scheduler items stay
	// registered and are queued again after the callback settles, so a slow
	// callback cannot overlap with itself.
	i.itemsMu.Lock()
	periodicOverflow := false
	switch item.kind {
	case "timer":
		if i.callbackTimers[item.token] == item {
			delete(i.callbackTimers, item.token)
		}
	case "scheduler":
		if i.schedulerTimers[item.name] == item {
			if item.period > 0 && !i.stopped {
				item.due = time.Now().Add(item.period)
				if len(i.pending) < maxPendingItems {
					i.pending = append(i.pending, item)
				} else {
					periodicOverflow = true
				}
			} else {
				delete(i.schedulerTimers, item.name)
			}
		}
	}
	i.itemsMu.Unlock()
	if periodicOverflow {
		i.log("warn", "dropped periodic runtime callback because the instance pending queue exceeded its bound", map[string]any{"name": item.name})
	}
	if err != nil {
		i.log("warn", "dispatched provider callback failed", map[string]any{"item": item.kind, "error": err.Error()})
	}
	return err
}

// waitLocked parks the settle loop until a queue token arrives, a queued future
// item comes due, the instance stops, or the context ends. Callers hold i.mu.
func (i *Instance) waitLocked(ctx context.Context, next time.Time) {
	var timerCh <-chan time.Time
	if !next.IsZero() {
		if until := time.Until(next); until > 0 {
			timer := time.NewTimer(until)
			defer func() {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
			}()
			timerCh = timer.C
		}
	}
	select {
	case <-i.wake:
	case <-timerCh:
	case <-i.done:
	case <-ctx.Done():
	}
}

// settleLocked drives a pending provider Promise to settlement by servicing
// the dispatch queue while it waits. Callers hold i.mu.
func (i *Instance) settleLocked(ctx context.Context, promise *goja.Promise) (any, error) {
	budget := i.awaitLimit()
	settleCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	for {
		// Item failures are already logged in runItem; they do not abort the
		// settle because the awaited promise may still progress.
		_, _ = i.serviceLocked(settleCtx)
		switch promise.State() {
		case goja.PromiseStateFulfilled:
			return promise.Result().Export(), nil
		case goja.PromiseStateRejected:
			return nil, fmt.Errorf("provider promise rejected: %v", promise.Result().Export())
		}
		if i.stopped {
			return nil, ErrStopped
		}
		if err := settleCtx.Err(); err != nil {
			if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
				return nil, fmt.Errorf("provider promise did not settle within %s", budget)
			}
			return nil, err
		}
		i.waitLocked(settleCtx, i.nextDue())
	}
}

// settle resolves a provider Promise (or plain value) into a JSON-safe value.
// Pending promises park until the dispatch queue advances them; already
// settled values return synchronously. Callers must hold i.mu.
func (i *Instance) settle(ctx context.Context, value goja.Value) (any, error) {
	if value == nil {
		return nil, nil
	}
	if object, ok := value.(*goja.Object); ok {
		if promise, ok := object.Export().(*goja.Promise); ok {
			switch promise.State() {
			case goja.PromiseStateFulfilled:
				return promise.Result().Export(), nil
			case goja.PromiseStateRejected:
				return nil, fmt.Errorf("provider promise rejected: %v", promise.Result().Export())
			default:
				if i.stopped {
					return nil, ErrStopped
				}
				return i.settleLocked(ctx, promise)
			}
		}
	}
	return value.Export(), nil
}

func (i *Instance) awaitLimit() time.Duration {
	if i.hookLimit >= defaultSettleLimit {
		return i.hookLimit
	}
	return defaultSettleLimit
}

func (i *Instance) startDispatcher() {
	i.startOnce.Do(func() { go i.dispatchLoop() })
}

// dispatchLoop services the queue when no lifecycle call owns the VM. It exits
// once the instance disposes.
func (i *Instance) dispatchLoop() {
	for {
		if i.disposed.Load() {
			return
		}
		next := i.nextDue()
		if !next.IsZero() {
			if until := time.Until(next); until > 0 {
				timer := time.NewTimer(until)
				select {
				case <-i.wake:
					if !timer.Stop() {
						select {
						case <-timer.C:
						default:
						}
					}
				case <-timer.C:
				case <-i.done:
					if !timer.Stop() {
						select {
						case <-timer.C:
						default:
						}
					}
					return
				}
			}
		} else {
			select {
			case <-i.wake:
			case <-i.done:
				return
			}
		}
		i.serviceIdle()
	}
}

// serviceIdle runs one bounded queue pass when the instance is not otherwise
// running JavaScript.
func (i *Instance) serviceIdle() {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.stopped || !i.started {
		return
	}
	passCtx, cancel := context.WithTimeout(context.Background(), i.hookLimit)
	defer cancel()
	if _, err := i.serviceLocked(passCtx); err != nil {
		i.log("warn", "dispatcher pass for provider events finished with errors", map[string]any{"error": err.Error()})
	}
}

// disposeQueue cancels every queued item and timer. Callers hold i.mu.
func (i *Instance) disposeQueue() {
	i.itemsMu.Lock()
	defer i.itemsMu.Unlock()
	i.pending = nil
	i.callbackTimers = map[uint64]*dispatchItem{}
	i.schedulerTimers = map[string]*dispatchItem{}
}

// removeCallbackTimer clears a setTimeout-scheduled callback by its id.
func (i *Instance) removeCallbackTimer(id uint64) {
	i.itemsMu.Lock()
	defer i.itemsMu.Unlock()
	if item := i.callbackTimers[id]; item != nil {
		i.dropItemLocked(item)
		delete(i.callbackTimers, id)
	}
}

// removeScheduledTimer clears a scheduler.timeout task by instance-local name.
func (i *Instance) removeScheduledTimer(name string) {
	i.itemsMu.Lock()
	defer i.itemsMu.Unlock()
	if item := i.schedulerTimers[name]; item != nil {
		i.dropItemLocked(item)
		delete(i.schedulerTimers, name)
	}
}

// dropItemLocked removes a queued-but-not-yet-run item. Callers hold itemsMu.
func (i *Instance) dropItemLocked(item *dispatchItem) {
	for n, pending := range i.pending {
		if pending == item {
			i.pending = append(i.pending[:n], i.pending[n+1:]...)
			return
		}
	}
}

// log forwards a structured runtime event to the configured sink.
func (i *Instance) log(level string, message string, fields map[string]any) {
	if i.logSink == nil {
		return
	}
	i.logSink(level, message, fields)
}
