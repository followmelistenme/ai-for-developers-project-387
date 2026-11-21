// Package availability applies calendar time rules independently of HTTP and storage.
package availability

import (
	"errors"
	"time"
)

// Slot is a half-open interval available for a meeting.
type Slot struct{ Start, End time.Time }

// Day contains the live booking window and available intervals for one calendar date.
type Day struct {
	WindowStart, WindowEnd, SelectedDate time.Time
	Slots                                []Slot
}

// ForDate calculates availability using a single captured instant and the calendar location.
// date is a calendar date, never an instant in the host time zone.
func ForDate(now time.Time, location *time.Location, date string, durationMinutes int) (Day, error) {
	local := now.In(location)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	result := Day{WindowStart: today.AddDate(0, 0, 1), WindowEnd: today.AddDate(0, 0, 14), Slots: []Slot{}}
	result.SelectedDate = result.WindowStart
	if date != "" {
		selected, err := time.ParseInLocation(time.DateOnly, date, location)
		if err != nil {
			return Day{}, err
		}
		result.SelectedDate = selected
	}
	if result.SelectedDate.Before(result.WindowStart) || result.SelectedDate.After(result.WindowEnd) {
		return Day{}, errors.New("date outside booking window")
	}
	year, month, day := result.SelectedDate.Date()
	start := time.Date(year, month, day, 9, 0, 0, 0, location)
	closeTime := time.Date(year, month, day, 18, 0, 0, 0, location)
	duration := time.Duration(durationMinutes) * time.Minute
	for ; !start.Add(duration).After(closeTime); start = start.Add(30 * time.Minute) {
		result.Slots = append(result.Slots, Slot{Start: start, End: start.Add(duration)})
	}
	return result, nil
}
