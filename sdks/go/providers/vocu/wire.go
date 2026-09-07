package vocu

import (
	"bytes"
	"encoding/json"
)

type wireEntry struct {
	name  string
	value any
}

// Vocu's splitter uses JSON object entry order for rules. encoding/json sorts
// map keys, putting entry10 before entry2; only these protocol objects need this.
type orderedObject []wireEntry

func (object orderedObject) MarshalJSON() ([]byte, error) {
	var data bytes.Buffer
	data.WriteByte('{')
	for index, entry := range object {
		key, err := json.Marshal(entry.name)
		if err != nil {
			return nil, err
		}
		value, err := json.Marshal(entry.value)
		if err != nil {
			return nil, err
		}
		if index > 0 {
			data.WriteByte(',')
		}
		data.Write(key)
		data.WriteByte(':')
		data.Write(value)
	}
	data.WriteByte('}')
	return data.Bytes(), nil
}
