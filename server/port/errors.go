// Package port holds the contract types every layer speaks: the coded error and its codes.
package port

import (
	"errors"
	"fmt"
)

// Error codes, chosen by meaning and never by transport status; the web client reads them as they are.
const (
	CodeInvalidArgument        = "INVALID_ARGUMENT"
	CodeNotFound               = "NOT_FOUND"
	CodeConflict               = "CONFLICT"
	CodeInvalidStateTransition = "INVALID_STATE_TRANSITION"
	CodeInvariantViolation     = "INVARIANT_VIOLATION"
	CodePermissionDenied       = "PERMISSION_DENIED"
	CodeRateLimited            = "RATE_LIMITED"
	CodeBanned                 = "BANNED"
	CodeInternal               = "INTERNAL"
)

// Error is the one coded error that reaches an inbound adapter; Detail is safe to show the caller.
type Error struct {
	Code   string
	Detail string
	Err    error
}

// NewError builds a coded error where a rule is detected.
func NewError(code, detail string) *Error {
	return &Error{Code: code, Detail: detail}
}

// WrapError builds a coded error that keeps its cause for the log.
func WrapError(code, detail string, err error) *Error {
	return &Error{Code: code, Detail: detail, Err: err}
}

// Error renders the code, the detail and the cause.
func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("[%s] %s: %v", e.Code, e.Detail, e.Err)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Detail)
}

// Unwrap exposes the wrapped cause.
func (e *Error) Unwrap() error { return e.Err }

// Classify returns the coded error in err's chain, or an internal error with a fixed detail.
func Classify(err error) *Error {
	var coded *Error
	if errors.As(err, &coded) {
		return coded
	}
	return &Error{Code: CodeInternal, Detail: "internal error", Err: err}
}

// CodeOf returns the code of a coded error, or an empty string for any other error.
func CodeOf(err error) string {
	var coded *Error
	if errors.As(err, &coded) {
		return coded.Code
	}
	return ""
}
