// Package meetingtype defines meeting types independently of HTTP and storage.
package meetingtype

import (
	"strings"
	"unicode/utf8"
)

// Status determines whether guests can view a meeting type.
type Status string

const (
	// Draft is visible only to the calendar owner.
	Draft Status = "draft"
	// Published is visible to guests.
	Published Status = "published"
	// Withdrawn permanently closes new bookings, retaining existing meetings.
	Withdrawn Status = "withdrawn"
)

// MeetingType is a saved type owned by the calendar owner.
type MeetingType struct {
	ID              string
	Status          Status
	Name            string
	Description     string
	DurationMinutes int
}

// NewDraft normalizes the input for a new meeting type.
func NewDraft(name, description string, durationMinutes int) (MeetingType, map[string]string) {
	name = strings.TrimSpace(name)
	fields := map[string]string{}
	if length := utf8.RuneCountInString(name); length < 1 || length > 100 {
		fields["name"] = "Введите название от 1 до 100 символов"
	}
	if utf8.RuneCountInString(description) > 500 {
		fields["description"] = "Описание должно быть не длиннее 500 символов"
	}
	switch durationMinutes {
	case 15, 30, 45, 60:
	default:
		fields["durationMinutes"] = "Выберите 15, 30, 45 или 60 минут"
	}
	return MeetingType{Status: Draft, Name: name, Description: description, DurationMinutes: durationMinutes}, fields
}
