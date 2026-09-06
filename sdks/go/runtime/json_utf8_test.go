package runtime

import "testing"

func TestValidUTF8JSON(t *testing.T) {
	for _, text := range []string{`{"word":"😀"}`, `{"word":"\ud83d\ude00"}`, `{"escaped":"\\ud800","quote":"\"","slash":"\/"}`, `{"\u0000":null}`, `[]`, `42`} {
		if !ValidUTF8JSON([]byte(text)) {
			t.Errorf("rejected %q", text)
		}
	}
	for _, text := range []string{`{"word":"\ud800"}`, `{"word":"\udc00"}`, `{"word":"\ud800x"}`, `{"word":"\ud800\u0041"}`, `{"\ud800":true}`, `"\ud83d\ude00\udc00"`, `"\u000`, `"unterminated`, string([]byte{'"', 255, '"'}), `NaN`, `{} []`} {
		if ValidUTF8JSON([]byte(text)) {
			t.Errorf("accepted %q", text)
		}
	}
}
