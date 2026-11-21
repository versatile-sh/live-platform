package room

// Geo is where Cloudflare placed a visitor; every field is empty when the header was absent.
type Geo struct {
	Country   string `json:"country,omitempty"`
	City      string `json:"city,omitempty"`
	Region    string `json:"region,omitempty"`
	Continent string `json:"continent,omitempty"`
	Timezone  string `json:"timezone,omitempty"`
	Latitude  string `json:"latitude,omitempty"`
	Longitude string `json:"longitude,omitempty"`
}

// Discord is the Discord identity the server itself took from a guest pass; a browser can never supply it.
type Discord struct {
	UserID    string `json:"user_id"`
	UserName  string `json:"user_name,omitempty"`
	GuildID   string `json:"guild_id,omitempty"`
	ChannelID string `json:"channel_id,omitempty"`
}

// Client is what the transport learned about the connection that asked to enter: address, place, browser and, when a guest pass vouched for it, the Discord origin.
type Client struct {
	IP             string   `json:"ip,omitempty"`
	Geo            Geo      `json:"geo"`
	UserAgent      string   `json:"user_agent,omitempty"`
	Browser        string   `json:"browser,omitempty"`
	OS             string   `json:"os,omitempty"`
	Device         string   `json:"device,omitempty"`
	AcceptLanguage string   `json:"accept_language,omitempty"`
	Discord        *Discord `json:"discord,omitempty"`
}
