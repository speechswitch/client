// Package runtime contains dependency-free primitives used by generated types.
package runtime

import "context"

// Optional distinguishes omission from a present zero, false, or nil value.
// Generated types do not resolve defaults before a provider/model is selected.
type Optional[T any] struct {
    Value T
    Present bool
}

func Some[T any](value T) Optional[T] { return Optional[T]{Value: value, Present: true} }

// Input is a pull-based producer. Next returns io.EOF at completion and must
// observe context cancellation. Close releases unfinished producer resources.
type Input[T any] interface {
    Next(context.Context) (T, error)
    Close() error
}
