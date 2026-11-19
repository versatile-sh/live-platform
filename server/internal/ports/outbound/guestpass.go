package outbound

import "context"

// GuestPass is what a trusted issuer hands for one visit: the name, the photo as base64 JPEG (empty for none) and how to create the room.
type GuestPass struct {
	Name    string `json:"name"`
	Face    string `json:"face"`
	Private bool   `json:"private"`
	Listed  bool   `json:"listed"`
	Slug    string `json:"slug"`
}

// GuestPasses hands a pass once by its id, or false when there is none or it is not valid.
type GuestPasses interface {
	Take(ctx context.Context, id string) (GuestPass, bool)
}
