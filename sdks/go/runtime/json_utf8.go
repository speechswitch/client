package runtime

import (
	"encoding/json"
	"strconv"
	"unicode/utf8"
)

// ValidUTF8JSON rejects strings encoding lone UTF-16 surrogates. encoding/json
// otherwise silently replaces them (and invalid UTF-8) with U+FFFD. Wire codecs
// using Go strings must reject unrepresentable text rather than alter its value.
func ValidUTF8JSON(data []byte) bool {
	if !utf8.Valid(data) || !json.Valid(data) {
		return false
	}
	for index := 0; index < len(data); index++ {
		if data[index] != '"' {
			continue
		}
		index++
		for data[index] != '"' {
			if data[index] != '\\' {
				index++
				continue
			}
			index++
			if data[index] != 'u' {
				index++
				continue
			}
			// json.Valid guarantees four hexadecimal digits and a closing quote.
			unit, _ := strconv.ParseUint(string(data[index+1:index+5]), 16, 16)
			index += 5
			if unit >= 0xdc00 && unit <= 0xdfff {
				return false
			}
			if unit >= 0xd800 && unit <= 0xdbff {
				if index+6 > len(data) || data[index] != '\\' || data[index+1] != 'u' {
					return false
				}
				low, err := strconv.ParseUint(string(data[index+2:index+6]), 16, 16)
				if err != nil || low < 0xdc00 || low > 0xdfff {
					return false
				}
				index += 6
			}
		}
	}
	return true
}
