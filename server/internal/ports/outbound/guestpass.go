package outbound

import "context"

// GuestPass is what a trusted issuer hands for one visit: the name, the photo as base64 JPEG (empty for none), how to create the room and, when known, the Discord origin.
type GuestPass struct {
	Name          string `json:"name"`
	Face          string `json:"face"`
	Private       bool   `json:"private"`
	Listed        bool   `json:"listed"`
	Slug          string `json:"slug"`
	DiscordUserID string `json:"discordUserId,omitempty"`
	DiscordName   string `json:"discordName,omitempty"`
	GuildID       string `json:"guildId,omitempty"`
	ChannelID     string `json:"channelId,omitempty"`
}

// GuestPasses hands a pass once by its id, or false when there is none or it is not valid.
type GuestPasses interface {
	Take(ctx context.Context, id string) (GuestPass, bool)
}
