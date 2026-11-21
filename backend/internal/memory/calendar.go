// Package memory stores one process-local calendar without persistence.
package memory

import (
	"crypto/rand"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/availability"
	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/meeting"
	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/meetingtype"
)

// Calendar owns meeting types and meetings for a single calendar owner.
type Calendar struct {
	mu       sync.RWMutex
	types    []meetingtype.MeetingType
	meetings []meeting.Meeting
	attempts map[string]meeting.Meeting
}

// AddDraft assigns a new identifier and saves a validated draft.
func (c *Calendar) AddDraft(draft meetingtype.MeetingType) meetingtype.MeetingType {
	c.mu.Lock()
	defer c.mu.Unlock()
	draft.ID = rand.Text()
	c.types = append(c.types, draft)
	return draft
}

// MeetingTypes returns a copy in creation order.
func (c *Calendar) MeetingTypes() []meetingtype.MeetingType {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return append([]meetingtype.MeetingType{}, c.types...)
}

// Publish exposes a draft; a withdrawn type can never be revived.
func (c *Calendar) Publish(id string) (meetingtype.MeetingType, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := range c.types {
		if c.types[i].ID == id {
			if c.types[i].Status == meetingtype.Withdrawn {
				return meetingtype.MeetingType{}, ErrInvalidTransition
			}
			c.types[i].Status = meetingtype.Published
			return c.types[i], nil
		}
	}
	return meetingtype.MeetingType{}, ErrTypeUnavailable
}

// Withdraw permanently closes new bookings under the same lock used by Confirm.
func (c *Calendar) Withdraw(id string) (meetingtype.MeetingType, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := range c.types {
		if c.types[i].ID == id {
			if c.types[i].Status == meetingtype.Draft {
				return meetingtype.MeetingType{}, ErrInvalidTransition
			}
			c.types[i].Status = meetingtype.Withdrawn
			return c.types[i], nil
		}
	}
	return meetingtype.MeetingType{}, ErrTypeUnavailable
}

// Delete checks all meetings and removes a type atomically with Confirm.
func (c *Calendar) Delete(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, item := range c.types {
		if item.ID == id {
			if slices.ContainsFunc(c.meetings, func(saved meeting.Meeting) bool { return saved.Type.ID == id }) {
				return ErrTypeHasMeetings
			}
			c.types = slices.Delete(c.types, i, i+1)
			return nil
		}
	}
	return ErrTypeUnavailable
}

// PublishedMeetingTypes returns the guest-visible types in creation order.
func (c *Calendar) PublishedMeetingTypes() []meetingtype.MeetingType {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := []meetingtype.MeetingType{}
	for _, item := range c.types {
		if item.Status == meetingtype.Published {
			result = append(result, item)
		}
	}
	return result
}

// PublishedMeetingType distinguishes a closed link from a hidden or unknown type.
func (c *Calendar) PublishedMeetingType(id string) (meetingtype.MeetingType, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, item := range c.types {
		if item.ID == id {
			if item.Status == meetingtype.Withdrawn {
				return meetingtype.MeetingType{}, ErrBookingClosed
			}
			if item.Status == meetingtype.Published {
				return item, nil
			}
		}
	}
	return meetingtype.MeetingType{}, ErrTypeUnavailable
}

// ErrTypeHasMeetings means at least one past, ongoing or future meeting prevents deletion.
var ErrTypeHasMeetings = errors.New("meeting type has meetings")

// ErrInvalidTransition means the requested lifecycle change is forbidden.
var ErrInvalidTransition = errors.New("invalid meeting type transition")

// ErrBookingClosed means publication has been permanently withdrawn.
var ErrBookingClosed = errors.New("booking closed")

// ErrTypeUnavailable means guests cannot book the requested type.
var ErrTypeUnavailable = errors.New("meeting type unavailable")

// ErrInvalidStart means the requested interval violates current calendar rules.
var ErrInvalidStart = errors.New("invalid meeting start")

// ErrBookingConflict means another meeting already occupies the interval.
var ErrBookingConflict = errors.New("meeting interval occupied")

// ErrAttemptMismatch prevents returning a saved confirmation to a different request.
var ErrAttemptMismatch = errors.New("attempt data differs")

// ErrInvalidContacts means guest details violate booking rules.
var ErrInvalidContacts = errors.New("invalid guest contacts")

// Confirm saves a meeting in the calendar shared by all meeting types.
func (c *Calendar) Confirm(attemptID, id string, now time.Time, location *time.Location, start time.Time, name, email string) (meeting.Meeting, availability.Day, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if saved, ok := c.attempts[attemptID]; ok {
		if saved.Type.ID != id || !saved.Start.Equal(start) || saved.GuestName != strings.TrimSpace(name) || saved.GuestEmail != strings.TrimSpace(email) {
			return meeting.Meeting{}, availability.Day{}, ErrAttemptMismatch
		}
		return saved, availability.Day{}, nil
	}
	if len(meeting.ValidateContacts(name, email)) != 0 {
		return meeting.Meeting{}, availability.Day{}, ErrInvalidContacts
	}
	for _, item := range c.types {
		if item.ID == id && item.Status == meetingtype.Withdrawn {
			return meeting.Meeting{}, availability.Day{}, ErrBookingClosed
		}
		if item.ID == id && item.Status == meetingtype.Published {
			start = start.In(location)
			day, err := availability.ForDate(now, location, start.Format(time.DateOnly), item.DurationMinutes)
			if err != nil || !slices.ContainsFunc(day.Slots, func(slot availability.Slot) bool { return slot.Start.Equal(start) }) {
				return meeting.Meeting{}, availability.Day{}, ErrInvalidStart
			}
			result := meeting.New(item, start, name, email)
			if c.overlaps(result.Start, result.End) {
				return meeting.Meeting{}, c.withFreeSlots(day), ErrBookingConflict
			}
			result.ID = rand.Text()
			c.meetings = append(c.meetings, result)
			if c.attempts == nil {
				c.attempts = make(map[string]meeting.Meeting)
			}
			c.attempts[attemptID] = result
			return result, availability.Day{}, nil
		}
	}
	return meeting.Meeting{}, availability.Day{}, ErrTypeUnavailable
}

// Meetings returns future and ongoing meetings, ordered from the soonest.
func (c *Calendar) Meetings(now time.Time) []meeting.Meeting {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := []meeting.Meeting{}
	for _, item := range c.meetings {
		if item.End.After(now) {
			result = append(result, item)
		}
	}
	slices.SortFunc(result, func(a, b meeting.Meeting) int { return a.Start.Compare(b.Start) })
	return result
}

// Available returns a consistent snapshot of the published type's free intervals.
func (c *Calendar) Available(id string, now time.Time, location *time.Location, date string) (availability.Day, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, item := range c.types {
		if item.ID == id && item.Status == meetingtype.Withdrawn {
			return availability.Day{}, ErrBookingClosed
		}
		if item.ID == id && item.Status == meetingtype.Published {
			day, err := availability.ForDate(now, location, date, item.DurationMinutes)
			if err != nil {
				return availability.Day{}, ErrInvalidStart
			}
			return c.withFreeSlots(day), nil
		}
	}
	return availability.Day{}, ErrTypeUnavailable
}

// Callers hold the calendar lock while checking occupancy and filtering slots.
func (c *Calendar) overlaps(start, end time.Time) bool {
	return slices.ContainsFunc(c.meetings, func(item meeting.Meeting) bool { return item.Overlaps(start, end) })
}

func (c *Calendar) withFreeSlots(day availability.Day) availability.Day {
	day.Slots = slices.DeleteFunc(day.Slots, func(slot availability.Slot) bool { return c.overlaps(slot.Start, slot.End) })
	return day
}
