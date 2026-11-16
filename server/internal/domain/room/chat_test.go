package room

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewChatText(t *testing.T) {
	cases := map[string]string{
		"hello":                  "hello",
		"  two\nlines  ":         "two\nlines",
		strings.Repeat("a", 500): strings.Repeat("a", 500),
		"":                       "",
		"   ":                    "",
		strings.Repeat("a", 501): "",
		"bell\x07":               "",
		"hidden\u202eoverride":   "",
		"tab\there":              "",
	}
	for raw, want := range cases {
		got, err := NewChatText(raw)
		assert.Equal(t, want, got, "%q", raw)
		assert.Equal(t, want == "", err != nil, "%q", raw)
	}
}
