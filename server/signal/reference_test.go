package signal

import (
	"encoding/base64"
	"encoding/json"

	"github.com/versatile-sh/live/server/core/room"
)

type photoFrame struct {
	T    string `json:"t"`
	PID  uint32 `json:"pid"`
	Data string `json:"data"`
}

type boardFrame struct {
	T    string          `json:"t"`
	PID  uint32          `json:"pid"`
	Data json.RawMessage `json:"data"`
}

func encodePhoto(pid room.PID, jpeg []byte) []byte {
	return mustJSON(photoFrame{T: "photo", PID: uint32(pid), Data: base64.StdEncoding.EncodeToString(jpeg)})
}

func encodeBoard(u room.BoardUpdate) []byte {
	return mustJSON(boardFrame{T: "board", PID: uint32(u.From), Data: json.RawMessage(u.Data)})
}
