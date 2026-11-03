package notifications

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// SendViaShoutrrr invokes the optional Shoutrrr CLI without a shell. Delivery
// targets are passed as one argument and each attempt has a strict deadline.
func SendViaShoutrrr(ctx context.Context, target, message string) error {
	if strings.TrimSpace(target) == "" || len(target) > 4096 || len(message) > 64*1024 {
		return ErrInvalid
	}
	binary := strings.TrimSpace(os.Getenv("SHOUTRRR_BINARY_PATH"))
	if binary == "" {
		binary = "shoutrrr"
	}
	deliveryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	output, err := exec.CommandContext(deliveryCtx, binary, "send", "--url", target, "--message", message).CombinedOutput()
	if err != nil {
		return fmt.Errorf("Shoutrrr delivery failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
