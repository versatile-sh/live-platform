// Package shared holds the types every aggregate uses.
package shared

import (
	"errors"
	"fmt"
)

// Error codes, chosen by meaning and never by transport status.
const (
	ErrCodeInvalidArgument        = "INVALID_ARGUMENT"
	ErrCodeNotFound               = "NOT_FOUND"
	ErrCodeConflict               = "CONFLICT"
	ErrCodeInvalidStateTransition = "INVALID_STATE_TRANSITION"
	ErrCodeInvariantViolation     = "INVARIANT_VIOLATION"
)

// DomainError is the only error type that leaves the domain.
type DomainError struct {
	Code    string
	Message string
	Err     error
}

// NewDomainError builds a DomainError with an optional wrapped cause.
func NewDomainError(code, message string, err error) *DomainError {
	return &DomainError{Code: code, Message: message, Err: err}
}

// Error renders the code, the message and the cause.
func (e *DomainError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("[%s] %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

// Unwrap exposes the wrapped cause.
func (e *DomainError) Unwrap() error { return e.Err }

// CodeOf returns the code of a DomainError, or an empty string for any other error.
func CodeOf(err error) string {
	var de *DomainError
	if errors.As(err, &de) {
		return de.Code
	}
	return ""
}
