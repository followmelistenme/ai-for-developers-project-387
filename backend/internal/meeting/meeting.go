// Package meeting defines a confirmed call independently of its HTTP representation.
package meeting

import (
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/meetingtype"
)

// Meeting preserves the type and guest details agreed at confirmation.
type Meeting struct {
	ID                    string
	Type                  meetingtype.MeetingType
	Start, End            time.Time
	GuestName, GuestEmail string
}

// New prepares the confirmed interval using the type's saved duration.
func New(item meetingtype.MeetingType, start time.Time, name, email string) Meeting {
	return Meeting{Type: item, Start: start, End: start.Add(time.Duration(item.DurationMinutes) * time.Minute), GuestName: strings.TrimSpace(name), GuestEmail: strings.TrimSpace(email)}
}

// ValidateContacts returns field errors without storing any guest data.
func ValidateContacts(name, email string) map[string]string {
	name, email = strings.TrimSpace(name), strings.TrimSpace(email)
	fields := map[string]string{}
	if n := utf8.RuneCountInString(name); n < 1 || n > 100 {
		fields["guestName"] = "Введите имя от 1 до 100 символов"
	}
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || utf8.RuneCountInString(email) > 254 {
		fields["guestEmail"] = "Введите корректный email до 254 символов"
	}
	return fields
}

// Overlaps uses half-open intervals: an end equal to another start is allowed.
func (m Meeting) Overlaps(start, end time.Time) bool {
	return m.Start.Before(end) && start.Before(m.End)
}
