package port

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestClassify(t *testing.T) {
	t.Run("a coded error wrapped with context keeps its code and detail", func(t *testing.T) {
		coded := NewError(CodeNotFound, "participant not found")
		got := Classify(fmt.Errorf("leave: %w", coded))
		assert.Same(t, coded, got)
	})
	t.Run("any other error is internal with a fixed detail and keeps its cause", func(t *testing.T) {
		cause := errors.New("disk on fire")
		got := Classify(cause)
		assert.Equal(t, CodeInternal, got.Code)
		assert.Equal(t, "internal error", got.Detail)
		assert.ErrorIs(t, got, cause)
	})
}
