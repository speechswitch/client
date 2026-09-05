package runtime

import "testing"

func TestOptionalPreservesExplicitZeroValues(t *testing.T) {
    var absent Optional[bool]
    if absent.Present { t.Fatal("zero Optional must mean omitted") }
    present := Some(false)
    if !present.Present || present.Value { t.Fatalf("unexpected explicit false: %#v", present) }
    var pointer *int
    nullable := Some(pointer)
    if !nullable.Present || nullable.Value != nil { t.Fatalf("unexpected explicit nil: %#v", nullable) }
}
